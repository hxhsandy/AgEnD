#!/usr/bin/env node
"use strict";
// The installer from the npm-selected target package, with its own Node.
process.argv.splice(2, 0, "_install-release");
require("./launch.cjs")("dist/cli.js", __dirname);
