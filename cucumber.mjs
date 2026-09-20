/**
 * Cucumber configuration for the BDD e2e suite.
 * Run with: pnpm test:bdd
 *
 * Note: for a .mjs config the exported object IS the default profile,
 * so there is intentionally no `default:` wrapper here.
 */
export default {
  paths: ['e2e/features'],
  // TypeScript is loaded by the `node --import tsx` wrapper in package.json.
  import: ['e2e/cucumber/**/*.ts'],
  format: ['progress-bar', ['html', 'reports/cucumber.html']],
  formatOptions: { snippetInterface: 'async-await' },
}
