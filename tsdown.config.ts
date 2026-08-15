/**
 * Two artifacts from one package, the shape every dsh plugin with a browser
 * half ships:
 *
 * - `lib/index.js` + `lib/contract.js` — the NODE half, imported by the host
 *   Loader from the emitted `lib/types` JavaScript. Here it carries the routes,
 *   the switchboard, and the delivery of a desktop press to the page in front.
 * - `lib/client.js` — the BROWSER half, a closure-factory artifact fetched
 *   outside any module graph. It calls `window.__ModuleLoader__.load({id,
 *   factory})` and resolves its externals through the injected `require`, so
 *   the platform modules it shares with the shell stay ONE instance.
 *
 * This config is a standalone restatement of the harness's own
 * `packages/client/tsdown.client.ts`. It is a sibling repository, so it cannot
 * import that preset; the values below are the contract with the shell's module
 * table and must track it.
 */
import { defineConfig } from 'tsdown'
import type { UserConfig } from 'tsdown'

/** This bundle's id: the package name, and the module-table key the shell fetches it under. */
const ID = '@omdsh-plugins/omdsh-shortcuts'

/**
 * The specifiers the shell seeds into the frozen module table. Mirrors
 * `@deepseek-ai/dsh-client-web/src/platform`, plus the documented runtime-store
 * exemption every UI plugin rides. Anything NOT listed here is inlined: a
 * `require()` the table cannot answer throws at factory time.
 *
 * This package's browser half currently reaches none of them — its only harness
 * imports are `import type`, which are erased before they get here. The list
 * stays anyway, because it is the rule the purity gate below is written
 * against, and the first value import should meet a table rather than a
 * surprise.
 */
const CLIENT_EXTERNALS: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Wire/type layers a client bundle may inline: no runtime identity to share. */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/
/** Generated descriptor/codec contribution, likewise identity-free. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/**
 * The node half, emitted from the JavaScript tsc already wrote to lib/types.
 *
 * `contract.js` is a second entry rather than something consumers reach through
 * the root, so a package that only wants the wire vocabulary — a test harness,
 * a second shell — can have it without pulling in the routes.
 */
const nodeHalf: UserConfig = {
  name: ID,
  entry: ['lib/types/index.js', 'lib/types/contract.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

/** The browser half, compiled from source straight into the loader artifact. */
const browserHalf: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  // Lands beside the node half; `clean` must stay off or it wipes that output.
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  // Types ship from lib/types (tsc); a dts pass here would wrap the
  // banner/footer into .d.cts and break parsing.
  dts: false,
  // Fetched outside Vite's module graph, so the bundle carries its own map.
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  // tsdown auto-externalizes package dependencies; the rule here is the table
  // itself — no opinion for its entries (the `external` above wins), inline
  // everything else.
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [{
    /**
     * Bundle purity gate, guarding two different mistakes.
     *
     * A cross-plugin value import either inlines a second copy of another
     * plugin's runtime or asks the frozen table for a specifier it cannot
     * answer. Collaboration goes through cordis services and the slot system;
     * type-only imports are erased and never reach here.
     *
     * A `node:` import is the mistake this package is uniquely exposed to. Its
     * two halves compile as ONE tsc program with `@types/node` present — which
     * the host half needs and the browser half must not use — so nothing in the
     * type system stops `src/client` from importing `node:http` and everything
     * downstream of it would fail in the browser instead. This is where that
     * boundary is actually enforced.
     */
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (source.startsWith('node:')) {
        throw new Error(
          `client bundle purity: "${source}" is a node builtin — the browser half shares a compiler program with the host half, `
          + 'so the node types are in scope for it and this is the only place the split is checked',
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module, an inline-safe wire layer, or a generated /remote contribution — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services',
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([nodeHalf, browserHalf])
