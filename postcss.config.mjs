// The stylesheet is hand-written: every class in `app/globals.css` is authored
// here, and no utility framework generates any of it. PostCSS therefore has no
// plugins to run. The static Pages build never resolved this file at all — it
// sets `root: "github-pages"` — so dropping the plugin also makes the two
// deployments agree on the reset instead of only one of them carrying preflight.
const config = {
  plugins: {},
};

export default config;
