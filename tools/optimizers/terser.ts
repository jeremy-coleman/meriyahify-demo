
var Terser = require("terser");
var fs = require('fs')
var jetpack = require('fs-jetpack')

var TERSER_CONFIG1 = {
      parse: {},
      compress: {
          passes: 4,
          dead_code: true,
          keep_infinity: true
      },
      mangle: {
          properties: {}
        },
      output: {},
      sourceMap: {},
      ecma: 8, // specify one of: 5, 6, 7 or 8
      keep_classnames: false,
      keep_fnames: false,
      ie8: false,
      module: true,
      nameCache: null,
      safari10: false,
      toplevel: true,
      warnings: false
}


var TERSER_CONFIG = {
      compress: {
          passes: 10,
          dead_code: true,
          keep_infinity: true,
          ecma: 9,
          hoist_funs: true,
          reduce_funcs: false, // i think this will cause polymorphic expressions
          unsafe_math: true,
          unsafe_proto: true, //good for perf maybe? but way slow to bundle
          unsafe_undefined: true, // turns undefined into void 0 , should really be called ensure_safe_undefined
          unsafe_regexp: true,
          negate_iife: false,
          unsafe_arrows: true, //arrow fns run faster in v8
          pure_getters: true,
          hoist_vars: true,
          arguments: true,
          unsafe_methods: true,
          
          //keep_fnames: true //idk seems like you should

      },
      // mangle:{
      //   //keep_fnames: true,
      //   module: true,
      //   //regex: /^_MIN_/
      // },

      ecma: 9,
      module: true,
      //nameCache: {},
      toplevel: true,
      output:{
        ecma: 9,
        wrap_iife: true
      }
}

function getFileSize(filePath) {
  var size = fs.statSync(filePath).size;
  var i = Math.floor( Math.log(size) / Math.log(1024) );
  //@ts-ignore
  return ( size / Math.pow(1024, i) ).toFixed(2) * 1 + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
}


async function runTerser(i,o){
  await jetpack.write(o, Terser.minify(jetpack.read(i), TERSER_CONFIG).code)
  console.log(getFileSize(o))
}

export {runTerser}
// async function runTerser2(i,o){
//   await jetpack.write(o, Terser.minify(jetpack.read(i)).code)
//   console.log(getFileSize(o))
// }

//runTerser('./src/main.js', './lib/main.js')



// function demostream(file) {
//   return through(function (buf, enc, next) {
//       this.push(buf.toString('utf8').replace(/\$CWD/g, process.cwd()));
//       next();
//   });
// };