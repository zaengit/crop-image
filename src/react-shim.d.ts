declare const React: {
  createElement: (...args: any[]) => any
  Fragment: any
  useState<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void]
  useRef<T>(initial: T): { current: T }
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
}

declare const ReactDOM: {
  render: (node: any, container: Element | DocumentFragment) => void
}

declare namespace JSX {
  interface IntrinsicAttributes {
    key?: string | number
  }
  interface IntrinsicElements {
    [elementName: string]: any
  }
}
