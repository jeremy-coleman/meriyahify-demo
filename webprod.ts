
import fs from 'fs'

//@ts-ignore
import  _ from 'lodash'
//import del from 'del'
import jetpack from 'fs-jetpack';

process.env.NODE_ENV="production"

/* -------------------------------------------------------------------------- */
/*                                 browserify                                 */
/* -------------------------------------------------------------------------- */
import {babelify} from './tools/transforms/babelify'
import browserify from './tools/transforms/browserify'
//import {watchify} from './tools/transforms/watchify'
import cssify from './tools/transforms/cssify'
//import {LiveReactloadPlugin} from './tools/transforms/livereactload'

//import {uglifyify} from './tools/transforms/tinyify'

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

const b = browserify({
    entries: ["src/app.tsx"],
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    cache: {},
    packageCache: {},
    debug: false,
    sourceMaps: false,
    fullPaths: false
})
b.transform(cssify)
b.transform(babelify.configure({
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  presets:[
    "@babel/preset-typescript",
    "@babel/preset-react",
    // ["@babel/preset-env",
    //   {
    //     targets: {node: "current", browsers: ["last 2 Chrome versions"]},
    //     // this means use polyfills, NOT ACTUAL FUCKING BUILTINS
    //     useBuiltIns: false,
    //     //loose: true
    //   }
    // ],
    //["babel-preset-minify"]
  ],
  plugins: [
      "@babel/plugin-proposal-class-properties",
      ["@babel/plugin-proposal-decorators", {"legacy": true}],
      ["@babel/plugin-syntax-jsx"],
      ['@babel/plugin-transform-modules-commonjs'],
      ["transform-inline-environment-variables", {
        "include": [
          "NODE_ENV"
        ]
      }],
      ["module-resolver", {
        "root": ["."],
        "alias": {
          "@coglite": "./src/packages",
          "react-dom":"./src/libs/react/react-dom.js",
          "react":"./src/libs/react/react.js"
        }
      }]
  ],
  sourceMaps: false
}))

//b.plugin(uglifyify)
//b.plugin(LiveReactloadPlugin(), { host: 'localhost', port: 1337 })
b.on('update', bundle)


import {runTerser} from './tools/optimizers/terser'
import {createSirver} from './tools/devserver/sirv'
const _firstLaunch = () => createSirver('dist')
const launch = _.once(_firstLaunch) //<- webserver or electron 

console.log("ENV:", process.env.NODE_ENV)

async function bundle() {
  b.bundle()
    .on('error', (e) => console.error(e))
    .pipe(fs.createWriteStream("dist/app-temp.js"))
    .on('close', () => 
      runTerser("dist/app-temp.js", "dist/app.js")
      .then(() => jetpack.remove("dist/app-temp.js"))
      .then(launch)
    ) 
}

bundle()




