use image::{imageops::FilterType, DynamicImage, ImageBuffer, ImageFormat, Rgba};
use serde::Deserialize;
use std::io::Cursor;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Deserialize)]
struct FocusRegion {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    confidence: f32,
    #[serde(default)]
    kind: String,
}

#[derive(Debug, Clone, Copy)]
struct Point { x: f32, y: f32 }

#[derive(Debug, Clone, Copy)]
struct Bounds { left: f32, top: f32, right: f32, bottom: f32 }

fn face_group_bounds(regions: &[FocusRegion], padding: f32) -> Option<Bounds> {
    let faces: Vec<&FocusRegion> = regions
        .iter()
        .filter(|r| r.kind == "face" && r.confidence >= 0.5)
        .collect();
    if faces.is_empty() { return None; }

    let (mut min_x, mut min_y, mut max_x, mut max_y) = (1.0f32, 1.0f32, 0.0f32, 0.0f32);
    for r in faces {
        min_x = min_x.min(r.x);
        min_y = min_y.min(r.y);
        max_x = max_x.max(r.x + r.width);
        max_y = max_y.max(r.y + r.height);
    }

    let width = (max_x - min_x).max(0.01);
    let height = (max_y - min_y).max(0.01);
    let pad = padding.max(0.0);
    let pad_x = width * pad;
    let pad_top = height * pad * 1.15;
    let pad_bottom = height * pad * 0.85;
    Some(Bounds {
        left: (min_x - pad_x).clamp(0.0, 1.0),
        top: (min_y - pad_top).clamp(0.0, 1.0),
        right: (max_x + pad_x).clamp(0.0, 1.0),
        bottom: (max_y + pad_bottom).clamp(0.0, 1.0),
    })
}

fn bounds_focus(bounds: Bounds) -> Point {
    Point {
        x: ((bounds.left + bounds.right) * 0.5).clamp(0.0, 1.0),
        // Bias slightly upward so portrait crops keep comfortable head room.
        y: (bounds.top * 0.53 + bounds.bottom * 0.47).clamp(0.0, 1.0),
    }
}

fn saliency_focus(rgba: &[u8], width: u32, height: u32) -> Point {
    let sample_w = width.min(96).max(8);
    let sample_h = height.min(96).max(8);
    let step_x = width as f32 / sample_w as f32;
    let step_y = height as f32 / sample_h as f32;
    let (mut weighted_x, mut weighted_y, mut weight_sum) = (0.0f64, 0.0f64, 0.0f64);
    let lum = |x: u32, y: u32| -> f32 {
        let i = ((y.min(height - 1) * width + x.min(width - 1)) * 4) as usize;
        0.2126 * rgba[i] as f32 + 0.7152 * rgba[i + 1] as f32 + 0.0722 * rgba[i + 2] as f32
    };

    for sy in 1..sample_h.saturating_sub(1) {
        for sx in 1..sample_w.saturating_sub(1) {
            let x = (sx as f32 * step_x) as u32;
            let y = (sy as f32 * step_y) as u32;
            let dx = (lum((x + step_x as u32).min(width - 1), y) - lum(x.saturating_sub(step_x as u32), y)).abs();
            let dy = (lum(x, (y + step_y as u32).min(height - 1)) - lum(x, y.saturating_sub(step_y as u32))).abs();
            let detail = (dx + dy + 1.0) as f64;
            let nx = x as f64 / width as f64;
            let ny = y as f64 / height as f64;
            let center_bias = (1.0 - (((nx - 0.5).powi(2) + (ny - 0.5).powi(2)).sqrt() * 0.45)).max(0.65);
            let w = detail * center_bias;
            weighted_x += nx * w;
            weighted_y += ny * w;
            weight_sum += w;
        }
    }

    if weight_sum <= f64::EPSILON {
        Point { x: 0.5, y: 0.5 }
    } else {
        Point { x: (weighted_x / weight_sum) as f32, y: (weighted_y / weight_sum) as f32 }
    }
}

fn apply_safe_area(focus: Point, safe_top: f32, safe_bottom: f32) -> Point {
    let top = safe_top.clamp(0.0, 0.45);
    let bottom = safe_bottom.clamp(0.0, 0.45);
    Point { x: focus.x.clamp(0.0, 1.0), y: focus.y.clamp(top, 1.0 - bottom) }
}

fn crop_dimensions(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> (u32, u32) {
    let src_ratio = src_w as f64 / src_h as f64;
    let dst_ratio = dst_w as f64 / dst_h as f64;
    if src_ratio > dst_ratio {
        ((src_h as f64 * dst_ratio).round() as u32, src_h)
    } else {
        (src_w, (src_w as f64 / dst_ratio).round() as u32)
    }
}

fn clamp_origin_to_contain(
    desired: f32,
    crop_size: u32,
    source_size: u32,
    bound_start: f32,
    bound_end: f32,
) -> f32 {
    let max_origin = source_size.saturating_sub(crop_size) as f32;
    let bound_start_px = bound_start.clamp(0.0, 1.0) * source_size as f32;
    let bound_end_px = bound_end.clamp(0.0, 1.0) * source_size as f32;
    let bound_size = bound_end_px - bound_start_px;

    if bound_size <= crop_size as f32 {
        let minimum = (bound_end_px - crop_size as f32).max(0.0);
        let maximum = bound_start_px.min(max_origin);
        if minimum <= maximum {
            return desired.clamp(minimum, maximum);
        }
    }
    desired.clamp(0.0, max_origin)
}

fn crop_rect_with_bounds(
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    focus: Point,
    bounds: Option<Bounds>,
) -> (u32, u32, u32, u32) {
    let (crop_w, crop_h) = crop_dimensions(src_w, src_h, dst_w, dst_h);
    let focus_x = focus.x.clamp(0.0, 1.0) * src_w as f32;
    let focus_y = focus.y.clamp(0.0, 1.0) * src_h as f32;
    let desired_x = focus_x - crop_w as f32 * 0.5;
    let desired_y = focus_y - crop_h as f32 * 0.5;

    let (x, y) = if let Some(group) = bounds {
        (
            clamp_origin_to_contain(desired_x, crop_w, src_w, group.left, group.right),
            clamp_origin_to_contain(desired_y, crop_h, src_h, group.top, group.bottom),
        )
    } else {
        (
            desired_x.clamp(0.0, src_w.saturating_sub(crop_w) as f32),
            desired_y.clamp(0.0, src_h.saturating_sub(crop_h) as f32),
        )
    };

    (x.round() as u32, y.round() as u32, crop_w.max(1), crop_h.max(1))
}

fn crop_rect(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32, focus: Point) -> (u32, u32, u32, u32) {
    crop_rect_with_bounds(src_w, src_h, dst_w, dst_h, focus, None)
}

#[wasm_bindgen]
pub fn smart_crop_png(
    rgba: &[u8],
    src_width: u32,
    src_height: u32,
    target_width: u32,
    target_height: u32,
    focus_regions_json: &str,
    safe_top: f32,
    safe_bottom: f32,
    face_padding: f32,
    manual_x: f32,
    manual_y: f32,
) -> Result<Vec<u8>, JsValue> {
    if rgba.len() != (src_width as usize * src_height as usize * 4) {
        return Err(JsValue::from_str("Invalid RGBA buffer size"));
    }
    if target_width == 0 || target_height == 0 || src_width == 0 || src_height == 0 {
        return Err(JsValue::from_str("Image dimensions must be greater than zero"));
    }

    let regions: Vec<FocusRegion> = serde_json::from_str(focus_regions_json).unwrap_or_default();
    let manual = manual_x >= 0.0 && manual_y >= 0.0;
    let face_bounds = if manual { None } else { face_group_bounds(&regions, face_padding) };
    let base_focus = if manual {
        Point { x: manual_x.clamp(0.0, 1.0), y: manual_y.clamp(0.0, 1.0) }
    } else if let Some(bounds) = face_bounds {
        bounds_focus(bounds)
    } else {
        saliency_focus(rgba, src_width, src_height)
    };
    let focus = apply_safe_area(base_focus, safe_top, safe_bottom);

    let source: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(src_width, src_height, rgba.to_vec())
        .ok_or_else(|| JsValue::from_str("Unable to create source image"))?;
    let (x, y, crop_w, crop_h) = crop_rect_with_bounds(
        src_width,
        src_height,
        target_width,
        target_height,
        focus,
        face_bounds,
    );
    let cropped = image::imageops::crop_imm(&source, x, y, crop_w, crop_h).to_image();
    let resized = image::imageops::resize(&cropped, target_width, target_height, FilterType::Lanczos3);
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(resized)
        .write_to(&mut out, ImageFormat::Png)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn landscape_to_portrait_keeps_full_height() {
        let (_, _, w, h) = crop_rect(4000, 3000, 1080, 1350, Point { x: 0.5, y: 0.5 });
        assert_eq!(h, 3000);
        assert_eq!(w, 2400);
    }

    #[test]
    fn focus_moves_crop_without_overflowing() {
        let (x, _, w, _) = crop_rect(4000, 3000, 1080, 1350, Point { x: 0.95, y: 0.5 });
        assert_eq!(w, 2400);
        assert_eq!(x, 1600);
    }

    #[test]
    fn multiple_faces_focus_between_people() {
        let faces = vec![
            FocusRegion { x: 0.1, y: 0.2, width: 0.2, height: 0.3, confidence: 0.9, kind: "face".into() },
            FocusRegion { x: 0.7, y: 0.2, width: 0.2, height: 0.3, confidence: 0.95, kind: "face".into() },
        ];
        let bounds = face_group_bounds(&faces, 0.1).unwrap();
        let focus = bounds_focus(bounds);
        assert!((focus.x - 0.5).abs() < 0.02);
    }

    #[test]
    fn face_group_is_kept_inside_crop_when_it_fits() {
        let bounds = Bounds { left: 0.35, top: 0.15, right: 0.72, bottom: 0.72 };
        let (x, y, w, h) = crop_rect_with_bounds(4000, 3000, 1080, 1350, Point { x: 0.8, y: 0.45 }, Some(bounds));
        let left = x as f32 / 4000.0;
        let right = (x + w) as f32 / 4000.0;
        let top = y as f32 / 3000.0;
        let bottom = (y + h) as f32 / 3000.0;
        assert!(left <= bounds.left + 0.001);
        assert!(right >= bounds.right - 0.001);
        assert!(top <= bounds.top + 0.001);
        assert!(bottom >= bounds.bottom - 0.001);
    }

    #[test]
    fn impossible_wide_face_group_still_stays_in_source() {
        let bounds = Bounds { left: 0.02, top: 0.2, right: 0.98, bottom: 0.7 };
        let (x, y, w, h) = crop_rect_with_bounds(4000, 3000, 1080, 1920, Point { x: 0.5, y: 0.45 }, Some(bounds));
        assert!(x + w <= 4000);
        assert!(y + h <= 3000);
    }

    #[test]
    fn safe_area_clamps_vertical_focus() {
        let focus = apply_safe_area(Point { x: 0.5, y: 0.98 }, 0.1, 0.2);
        assert!(focus.y <= 0.8);
    }

    #[test]
    fn manual_focus_can_target_edge() {
        let (x, _, _, _) = crop_rect(4000, 3000, 1080, 1350, Point { x: 0.0, y: 0.5 });
        assert_eq!(x, 0);
    }
}
