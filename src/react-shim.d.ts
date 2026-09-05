declare const React: {
  createElement: (...args: any[]) => any
}

declare const ReactDOM: {
  render: (node: any, container: Element | DocumentFragment) => void
}

declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: any
  }
}
