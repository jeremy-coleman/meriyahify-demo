
import fs from 'fs'

//@ts-ignore
import  _ from 'lodash'
//import del from 'del'
import jetpack from 'fs-jetpack';


/* -------------------------------------------------------------------------- */
/*                                 browserify                                 */
/* -------------------------------------------------------------------------- */
import {babelify} from './tools/transforms/babelify'
import browserify from './tools/transforms/browserify'
import {watchify} from './tools/transforms/watchify'
import cssify from './tools/transforms/cssify'
import {LiveReactloadPlugin} from './tools/transforms/livereactload'
import {tsify} from './tools/transforms/tsify'

function sleep(ms){
  return new Promise(resolve=> {
      setTimeout(resolve,ms)
  })
}

// async function clean1() {
//     del(['dist']);
//     await sleep(3000)
//     jetpack.dir('dist')
//   return
// }

function clean() {
  async function _clean() {
  await jetpack.remove('dist')
  return jetpack.dir('dist')
  }
  return _clean()
}

clean()

function copy(){
  return jetpack.copy("src/index.html", "dist/index.html")
}
copy()

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
b.transform(babelify.configure({
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  presets:[
    "@babel/preset-typescript",
    "@babel/preset-react",
    "@babel/preset-env"
  ],
  plugins: [
      "@babel/plugin-proposal-class-properties",
      ["@babel/plugin-proposal-decorators", {"legacy": true}],
      ["@babel/plugin-syntax-jsx"],
      ['@babel/plugin-transform-modules-commonjs'],
      ["module-resolver", {
        "root": ["."],
        "alias": {"@coglite": "./src/packages"}
      }],
      "react-hot-loader/babel"
  ],
  sourceMaps: false
}))

b.plugin(LiveReactloadPlugin(), { host: 'localhost', port: 1337 })
b.on('update', bundle)

import {createSirver} from './tools/devserver/sirv'
const _firstLaunch = () => createSirver('dist')
const launch = _.once(_firstLaunch)

async function bundle() {
  b.bundle()
    .on('error', (e) => console.error(e))
    .pipe(fs.createWriteStream("dist/app.js"))
    .on('close', launch) //<- webserver or electron 
}

bundle()




