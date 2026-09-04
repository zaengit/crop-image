use image::{imageops::FilterType, DynamicImage, ImageBuffer, ImageFormat, Rgba};
use serde::Deserialize;
use std::io::Cursor;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Deserialize)]
struct FocusRegion { x: f32, y: f32, width: f32, height: f32, confidence: f32, #[serde(default)] kind: String }
#[derive(Debug, Clone, Copy)]
struct Point { x: f32, y: f32 }

fn face_focus(regions: &[FocusRegion]) -> Option<Point> {
    if regions.is_empty() { return None; }
    let mut total = 0.0f32; let mut x = 0.0f32; let mut y = 0.0f32;
    for r in regions {
        let kind_weight = if r.kind == "face" { 1.25 } else { 1.0 };
        let weight = r.confidence.max(0.05) * (r.width * r.height).sqrt().max(0.08) * kind_weight;
        x += (r.x + r.width * 0.5) * weight; y += (r.y + r.height * 0.42) * weight; total += weight;
    }
    (total > 0.0).then_some(Point { x: (x / total).clamp(0.0, 1.0), y: (y / total).clamp(0.0, 1.0) })
}

fn saliency_focus(rgba: &[u8], width: u32, height: u32) -> Point {
    let sample_w = width.min(96).max(8); let sample_h = height.min(96).max(8);
    let step_x = width as f32 / sample_w as f32; let step_y = height as f32 / sample_h as f32;
    let mut weighted_x = 0.0f64; let mut weighted_y = 0.0f64; let mut weight_sum = 0.0f64;
    let lum = |x: u32, y: u32| -> f32 { let i = ((y.min(height - 1) * width + x.min(width - 1)) * 4) as usize; 0.2126 * rgba[i] as f32 + 0.7152 * rgba[i + 1] as f32 + 0.0722 * rgba[i + 2] as f32 };
    for sy in 1..sample_h.saturating_sub(1) {
        for sx in 1..sample_w.saturating_sub(1) {
            let x = (sx as f32 * step_x) as u32; let y = (sy as f32 * step_y) as u32;
            let dx = (lum((x + step_x as u32).min(width - 1), y) - lum(x.saturating_sub(step_x as u32), y)).abs();
            let dy = (lum(x, (y + step_y as u32).min(height - 1)) - lum(x, y.saturating_sub(step_y as u32))).abs();
            let detail = (dx + dy + 1.0) as f64; let nx = x as f64 / width as f64; let ny = y as f64 / height as f64;
            let center_bias = (1.0 - (((nx - 0.5).powi(2) + (ny - 0.5).powi(2)).sqrt() * 0.45)).max(0.65); let w = detail * center_bias;
            weighted_x += nx * w; weighted_y += ny * w; weight_sum += w;
        }
    }
    if weight_sum <= f64::EPSILON { return Point { x: 0.5, y: 0.5 }; }
    Point { x: (weighted_x / weight_sum) as f32, y: (weighted_y / weight_sum) as f32 }
}

fn crop_rect(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32, focus: Point) -> (u32, u32, u32, u32) {
    let src_ratio = src_w as f64 / src_h as f64; let dst_ratio = dst_w as f64 / dst_h as f64;
    let (crop_w, crop_h) = if src_ratio > dst_ratio { ((src_h as f64 * dst_ratio).round() as u32, src_h) } else { (src_w, (src_w as f64 / dst_ratio).round() as u32) };
    let focus_x = focus.x.clamp(0.0, 1.0) * src_w as f32; let focus_y = focus.y.clamp(0.0, 1.0) * src_h as f32;
    let x = (focus_x - crop_w as f32 * 0.5).clamp(0.0, src_w.saturating_sub(crop_w) as f32).round() as u32;
    let y = (focus_y - crop_h as f32 * 0.5).clamp(0.0, src_h.saturating_sub(crop_h) as f32).round() as u32;
    (x, y, crop_w.max(1), crop_h.max(1))
}

#[wasm_bindgen]
pub fn smart_crop_png(rgba: &[u8], src_width: u32, src_height: u32, target_width: u32, target_height: u32, focus_regions_json: &str) -> Result<Vec<u8>, JsValue> {
    if rgba.len() != (src_width as usize * src_height as usize * 4) { return Err(JsValue::from_str("Invalid RGBA buffer size")); }
    if target_width == 0 || target_height == 0 || src_width == 0 || src_height == 0 { return Err(JsValue::from_str("Image dimensions must be greater than zero")); }
    let regions: Vec<FocusRegion> = serde_json::from_str(focus_regions_json).unwrap_or_default();
    let focus = face_focus(&regions).unwrap_or_else(|| saliency_focus(rgba, src_width, src_height));
    let source: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(src_width, src_height, rgba.to_vec()).ok_or_else(|| JsValue::from_str("Unable to create source image"))?;
    let (x, y, crop_w, crop_h) = crop_rect(src_width, src_height, target_width, target_height, focus);
    let cropped = image::imageops::crop_imm(&source, x, y, crop_w, crop_h).to_image();
    let resized = image::imageops::resize(&cropped, target_width, target_height, FilterType::Lanczos3);
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(resized).write_to(&mut out, ImageFormat::Png).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn landscape_to_portrait_keeps_full_height() { let (_, _, w, h) = crop_rect(4000, 3000, 1080, 1350, Point { x: 0.5, y: 0.5 }); assert_eq!(h, 3000); assert_eq!(w, 2400); }
    #[test]
    fn focus_moves_crop_without_overflowing() { let (x, _, w, _) = crop_rect(4000, 3000, 1080, 1350, Point { x: 0.95, y: 0.5 }); assert_eq!(w, 2400); assert_eq!(x, 1600); }
}
