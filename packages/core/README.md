# @yrdsl/core

Shared zod schemas and TypeScript types for the [yrdsl.app](https://yrdsl.app)
JSON shapes (`SaleSite`, `SaleItem`, `SaleContact`, etc.) used by both the
hosted version and the [self-hosted template](https://github.com/KuvopLLC/yrdsl-self-hosted).

## Install

```bash
npm install @yrdsl/core
```

## Usage

```ts
import { SaleSite, SaleItem } from '@yrdsl/core';

const parsed = SaleSite.safeParse(siteJson);
if (!parsed.success) {
  for (const issue of parsed.error.issues) console.error(issue);
}
```

Schemas live at `@yrdsl/core/schemas`, validation helpers at
`@yrdsl/core/validation`. The main entry re-exports both.

## Source

<https://github.com/KuvopLLC/yrdsl/tree/main/packages/core>

## License

MIT.
