# @yrdsl/viewer

React component that renders a [yrdsl.app](https://yrdsl.app) digital yard sale
page from `SaleSite` + `SaleItem[]` JSON. The same component powers the
hosted version and the
[self-hosted template](https://github.com/KuvopLLC/yrdsl-self-hosted).

## Install

```bash
npm install @yrdsl/viewer @yrdsl/core react
```

## Usage

```tsx
import { SaleViewer } from '@yrdsl/viewer';
import '@yrdsl/viewer/styles.css';

export function App({ site, items }) {
  return <SaleViewer site={site} items={items} />;
}
```

`site` and `items` should satisfy the schemas exported by `@yrdsl/core`.

## Source

<https://github.com/KuvopLLC/yrdsl/tree/main/packages/viewer>

## License

MIT.
