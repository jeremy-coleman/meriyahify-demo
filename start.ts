
import fs from 'fs'
import path from 'path'
import _ from 'lodash'
import jetpack from 'fs-jetpack';

//require('./ts-check')

/* -------------------------------------------------------------------------- */
/*                                 browserify                                 */
/* -------------------------------------------------------------------------- */
//import {babelify} from './tools/transforms/babelify'
import sucrasify from './tools/browserify/transforms/sucrasify'
//import sucrasify from './tools/browserify/transforms/sucrasify-hot'

import browserify from './tools/browserify/browserify'
import {watchify} from './tools/browserify/watchify'
import cssify from './tools/browserify/transforms/lessify'

//import {LiveReactloadPlugin} from './tools/browserify/transforms/livepreactload'
import {LiveReactloadPlugin} from './tools/browserify/transforms/livereactload'

import {tsify} from './tools/browserify/transforms/tsxify'

var aliasify = require("aliasify");
var envify = require("loose-envify/custom");

const {polka, sirv} = require('./tools/browserify/devserver')
const { PORT = 3002 } = process.env;

function setup(){
  jetpack.remove('dist')
  jetpack.dir('dist')
  jetpack.copy("src/index.html", "dist/index.html")
}
setup()

const b = watchify(browserify({
    entries: ["src/app.tsx"],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    cache: {},
    packageCache: {},
    debug: false,
    sourceMaps: false,
    fullPaths: false
}))
b.plugin(tsify)
b.transform(cssify)
b.transform(sucrasify)
b.plugin(LiveReactloadPlugin(), { host: 'localhost', port: 1337 })

// b.transform([
//   envify({
//     NODE_ENV: "development"
//   }), {global: true}
// ])

b.transform([
  aliasify.configure({
    aliases: {
      "react": "react/cjs/react.production.min.js",
      "react-dom": "react-dom/cjs/react-dom.production.min.js"
    },
    appliesTo: { includeExtensions: [".js", ".jsx", ".tsx", ".ts"] }
  }),
  { global: true }
])


b.on('update', bundle)


async function bundle() {
  b.bundle()
    .on('error', (e) => console.error(e))
    .pipe(fs.createWriteStream("dist/app.js"))
    //.on('close', launch) //<- webserver or electron 
}

bundle()


const allowAMP = res => res.setHeader('AMP-Access-Control-Allow-Source-Origin', `http://localhost:${PORT}`);

polka()
  .use(sirv(path.resolve(__dirname, 'dist'), {dev: true, setHeaders: res => allowAMP(res)}))
  .get('/health', (req, res) => {res.end('OK')})
  //.get('*', (req, res) => {res.end(fs.readFileSync(path.resolve(__dirname, "dist", "index.html")))})
  .listen(PORT, () => {console.log(`> Running on http://localhost:${PORT}`)});

