import { createProject } from "gulp-typescript";
import * as through2 from "through2";
import * as merge from "merge2";
import * as File from "vinyl";
import Module from "./PolymerModule";
import ReadWriteStream = NodeJS.ReadWriteStream;

interface FilePair {
  js?: File & { contents: Buffer };
  ts?: File & { contents: Buffer };
}

const defaultProjectConfig = {
  experimentalDecorators: true,
  declaration: true,
  noEmitHelpers: true,
  sourceMap: false,
  target: "es6",
  module: "commonjs",
  lib: [
    "dom",
    "es6"
  ]
};

function ts2html(input) {
  let map: Map<string, FilePair> = new Map<string, FilePair>();
  let tsStream: ReadWriteStream & { js: ReadWriteStream; dts: ReadWriteStream } = input
    .pipe(through2.obj((file, enc, next) => file.path.endsWith(".ts") ? next(null, file) : next()))
    .pipe(createProject(Object.assign({ removeComments: true }, defaultProjectConfig))());

  let nonTsStream: ReadWriteStream = input
    .pipe(through2.obj((file, enc, next) => file.path.endsWith(".ts") ? next() : next(null, file)));

  return merge([
    nonTsStream,
    merge([ tsStream.dts, tsStream.js ])
      .pipe(through2.obj(function (file, enc, next) {
        let ext = "";
        let path = file.path.replace(/\.(js)|\.d\.(ts)/, (_, js, dts) => {
          ext = js || dts;
          return ".html";
        });

        let pair = map.get(path);
        if (!pair) {
          pair = {};
          map.set(path, pair);
        }

        pair[ ext ] = file;

        if (pair.js && pair.ts) {
          map.delete(path);
          this.push(pair.ts);
          this.push(new File({
            path, cwd: file.cwd, base: file.base,
            contents: new Module(file.base, pair.ts.contents.toString(), pair.js.contents.toString()).toBuffer()
          }));
        }
        next();
      }))
  ]);
}

export = ts2html;
