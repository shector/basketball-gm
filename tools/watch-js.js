// @flow

const browserify = require("browserify");
const envify = require("envify/custom");
const fs = require("fs");
const watchify = require("watchify");
const build = require("./buildFuncs");

console.log("Watching JavaScript files...");

for (const name of ["ui", "worker"]) {
    // Mostly copied from cmd.js in watchify

    const b = browserify(`src/js/${name}/index.js`, {
        debug: true,
        cache: {},
        packageCache: {},
    })
        .transform(envify({ NODE_ENV: "development" }), { global: true })
        .plugin(watchify);

    let bytes = 0;
    let time = 0;
    b.on("bytes", bytesLocal => {
        bytes = bytesLocal;
    });
    b.on("time", timeLocal => {
        time = timeLocal;
    });

    const outFilename = `build/gen/${name}.js`;

    const bundle = () => {
        let didError = false;

        const writeStream = fs.createWriteStream(outFilename);
        writeStream.on("error", err => {
            console.error(err);
        });

        b.bundle()
            .on("error", err => {
                console.error(String(err));
                if (!didError) {
                    didError = true;
                    writeStream.end(
                        `console.error(${JSON.stringify(String(err))});`,
                    );
                }
            })
            .pipe(writeStream);

        writeStream.on("finish", async () => {
            if (!didError) {
                await build.buildSW();

                console.log(
                    `${(bytes / 1024 / 1024).toFixed(
                        2,
                    )} MB written to ${outFilename} (${(time / 1000).toFixed(
                        2,
                    )} seconds) at ${new Date().toLocaleTimeString()}`,
                );
            }
        });
    };

    b.on("update", bundle);
    bundle();
}
