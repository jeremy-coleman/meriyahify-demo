import jetpack from 'fs-jetpack'
import { parse, Options } from "acorn";

function _parse(src, opts) {
  if (!opts) opts = {};
  return parse(src, opts);
}

//this isnt really effective, because top scope runs through module deps first

function createSyntaxError(src, file, opts?: Options) {
  if (typeof src !== "string") src = String(src);

  try {
    eval('throw "STOP"; (function () { ' + src + "\n})()");
    return;
  } 
  catch (err) {
    //console.log("-----",err,"-------")
    if (err === "STOP") return undefined;
    if (err.constructor.name !== "SyntaxError") return err;
    else return maybeParseError(src, file, opts);
  }
}

function maybeParseError (src, file, opts) {
  try { parse(src,opts) }
  catch (err) {
      return new ParseError(err, src, file);
  }
  return undefined;
}


function ParseError(err, src, file) {
  SyntaxError.call(this);

  this.message = err.message.replace(/\s+\(\d+:\d+\)$/, "");

  this.line = err.loc.line;
  this.column = err.loc.column + 1;

  this.annotated =
    "\n" +
    (file || "(anonymous file)") +
    ":" +
    this.line +
    "\n" +
    src.split("\n")[this.line - 1] +
    "\n" +
    Array(this.column).join(" ") +
    "^" +
    "\n" +
    "ParseError: " +
    this.message;
}

ParseError.prototype = Object.create(SyntaxError.prototype);

ParseError.prototype.toString = function () {
  return this.annotated;
};

ParseError.prototype.inspect = function () {
  return this.annotated;
};



function filterMessage(message){
  if(message){

  }
}





export { createSyntaxError };
