import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

import {parseAndDesugar} from "../../src/parsing/parser";
import {isSvelteFile, maskSvelte} from "../../src/parsing/svelte";
import {resolveModule} from "../../src/misc/files";
import {options, resetOptions} from "../../src/options";
import logger from "../../src/misc/logger";
import Solver from "../../src/analysis/solver";
import {realpathSync} from "fs";

describe("tests/unit/svelte", () => {

    beforeAll(() => {
        resetOptions();
        logger.transports[0].level = options.loglevel = "error";
    });

    describe("isSvelteFile", () => {
        test("accepts .svelte files and specifiers", () => {
            expect(isSvelteFile("Component.svelte")).toBe(true);
            expect(isSvelteFile("#lib/components/Widget.svelte")).toBe(true);
            expect(isSvelteFile("Component.svelte.ts")).toBe(false);
            expect(isSvelteFile("Component.ts")).toBe(false);
        });
    });

    describe("maskSvelte", () => {
        const component = [
            "<script context=\"module\">",
            "\texport const shared = 1;",
            "</script>",
            "",
            "<script lang=\"ts\">",
            "\timport {helper} from './helper';",
            "</script>",
            "",
            "<button onclick={shared}>{shared}</button>",
        ].join("\n");

        test("preserves length and line breaks", () => {
            const masked = maskSvelte(component);
            expect(masked.length).toBe(component.length);
            expect(masked.split("\n").length).toBe(component.split("\n").length);
        });

        test("keeps only the script contents", () => {
            const masked = maskSvelte(component).split("\n");
            // line numbers are 1-based
            expect(masked[0]).toBe(" ".repeat("<script context=\"module\">".length));
            expect(masked[1]).toBe("\texport const shared = 1;");
            expect(masked[2]).toBe(" ".repeat("</script>".length));
            expect(masked[6]).toBe(" ".repeat("</script>".length));
            expect(masked[8].trim()).toBe("");
        });

        test("handles '>' inside attribute values", () => {
            const withGenerics = [
                "<script lang=\"ts\" generics=\"T extends Record<string, unknown>\">",
                "\tconst x: T = null as any;",
                "</script>",
                "<p>{x}</p>",
            ].join("\n");
            const masked = maskSvelte(withGenerics).split("\n");
            expect(masked[1]).toBe("\tconst x: T = null as any;");
            expect(masked[3].trim()).toBe("");
        });

        test("component without script becomes blank", () => {
            const markup = "<div>hello</div>\n<span>world</span>";
            expect(maskSvelte(markup).trim()).toBe("");
        });

        test("unterminated script does not throw", () => {
            const broken = "<script>\nlet x = 1;";
            expect(() => maskSvelte(broken)).not.toThrow();
        });
    });

    describe("parseAndDesugar", () => {
        test("parses the merged <script> blocks with original locations", () => {
            const component = [
                "<script context=\"module\">", // line 1
                "\texport const shared = () => 1;", // line 2
                "</script>", // line 3
                "<script lang=\"ts\">", // line 4
                "\timport {helper} from './helper';", // line 5
                "\tfunction onClick() { helper(); }", // line 6
                "</script>", // line 7
                "<button onclick={onClick}>x</button>", // line 8
            ].join("\n");
            const ast = parseAndDesugar(component, path.resolve("Component.svelte"));
            expect(ast).not.toBeNull();
            const body = ast!.program.body;
            expect(body).toHaveLength(3);
            expect(body[0].loc!.start.line).toBe(2);
            expect(body[1].loc!.start.line).toBe(5);
            expect(body[2].loc!.start.line).toBe(6);
        });

        test("component without script parses to an empty module", () => {
            const ast = parseAndDesugar("<div>hello</div>", path.resolve("Markup.svelte"));
            expect(ast).not.toBeNull();
            expect(ast!.program.body).toHaveLength(0);
        });
    });

    describe("resolveModule", () => {
        interface NestedDirectoryJSON {
            [key: string]: NestedDirectoryJSON | string;
        }

        async function setUpTmpDir(vol: NestedDirectoryJSON): Promise<string> {
            const basedir = await fs.mkdtemp(path.join(os.tmpdir(), "jelly-test-svelte-"));
            async function write(dir: string, entries: NestedDirectoryJSON) {
                for (const [name, content] of Object.entries(entries)) {
                    const subpath = path.join(dir, name);
                    if (typeof content === "string")
                        await fs.writeFile(subpath, content);
                    else {
                        await fs.mkdir(subpath);
                        await write(subpath, content);
                    }
                }
            }
            await write(basedir, vol);
            return realpathSync(basedir);
        }

        const vol: NestedDirectoryJSON = {
            "./package.json": JSON.stringify({
                name: "svelte-app",
                type: "module",
                imports: {"#lib/*": "./src/lib/*"},
            }),
            "./tsconfig.json": JSON.stringify({compilerOptions: {module: "esnext", moduleResolution: "bundler", baseUrl: ".", paths: {"#lib": ["./src/lib/index.ts"], "#lib/*": ["./src/lib/*"]}}}),
            "./src": {
                "./components": {
                    "./App.svelte": "",
                    "./Mini.svelte": "",
                },
                "./lib": {
                    "./Widget.svelte": "",
                    "./util.ts": "export const util = 1;",
                },
            },
        };

        test("relative .svelte import", async () => {
            const basedir = options.basedir = await setUpTmpDir(vol);
            try {
                const from = path.resolve(basedir, "src/components/App.svelte");
                const solver = new Solver();
                expect(resolveModule("module", "./Mini.svelte", from, solver.globalState))
                    .toBe(path.resolve(basedir, "src/components/Mini.svelte"));
            } finally {
                await fs.rm(basedir, {recursive: true});
            }
        });

        test("aliased .svelte import via package.json imports", async () => {
            const basedir = options.basedir = await setUpTmpDir(vol);
            try {
                const from = path.resolve(basedir, "src/components/App.svelte");
                const solver = new Solver();
                expect(resolveModule("module", "#lib/Widget.svelte", from, solver.globalState))
                    .toBe(path.resolve(basedir, "src/lib/Widget.svelte"));
            } finally {
                await fs.rm(basedir, {recursive: true});
            }
        });

        test("extensionless TypeScript import from a .svelte file", async () => {
            const basedir = options.basedir = await setUpTmpDir(vol);
            try {
                const from = path.resolve(basedir, "src/components/App.svelte");
                const solver = new Solver();
                expect(resolveModule("module", "#lib/util", from, solver.globalState))
                    .toBe(path.resolve(basedir, "src/lib/util.ts"));
            } finally {
                await fs.rm(basedir, {recursive: true});
            }
        });
    });
});
