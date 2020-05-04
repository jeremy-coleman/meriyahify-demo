const cp = require("child_process");
const path = require("path");

const colors = {
  reset: "\x1b[0m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  crimson: "\x1b[38m"
};

const logSymbols = {
  info: colors.blue + "i" + colors.reset,
  success: colors.green + "√" + colors.reset,
  warning: colors.yellow + "‼" + colors.reset,
  error: colors.red + "×" + colors.reset
};

const MESSAGES = {
  TS_ERROR_BANNER: colors.red + colors.underline + `typescript errors` + colors.reset,
  printErrorPath: (v) => colors.yellow + colors.underline + `${v}` + colors.reset,
  printSuccess: (v) =>
    v === 1
      ? colors.green + `TsCheck done with 1 error` + colors.reset
      : colors.green + `TsCheck done with ${v} errors` + colors.reset
};


const getAllErrorPaths = (buf = "") => {
  const clickablePaths = new Set()
  
  ;buf
    .split("\r\n")
    .filter(line => line.includes("):" && "/"))
    .forEach((msg) => {
        const errPath = msg.slice(0, msg.indexOf(')')+1)
        clickablePaths.add(errPath)
    })
  ;return clickablePaths
  ;
};

const resolveBinFilePath = (binCommand) => {
  const cmd = process.platform === "win32" ? `${binCommand}.cmd` : binCommand;
  return path.resolve(__dirname, "node_modules", ".bin", cmd);
};


const main = () => {
  const child = cp.spawn(resolveBinFilePath("tsc"), ["-p", "tsconfig.json", "-w", "--noEmit"], {
    cwd: path.resolve(__dirname),
    shell: true,
    windowsHide: true
  })
  
  //this is printed by the ts cli on file change, watching for this piggybacks on tsc's watcher
  const marker = `. Watching for file changes.`;
  let buffer = "";

  child.stdout.setEncoding("utf8");
  
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    while (true) {
      if (!buffer.includes(marker)) {
        break;
      }
      let typeErrorPaths = getAllErrorPaths(buffer);

      //print all the error sources
      if (typeErrorPaths.size > 0) {
        typeErrorPaths.forEach((v) => console.info(logSymbols.warning, MESSAGES.printErrorPath(v)));
      }

      console.info(logSymbols.success, MESSAGES.printSuccess(typeErrorPaths.size));

      //console.info(process.memoryUsage().heapUsed)

      //reset the buffer
      buffer = "";
    }
  });
};

main();
