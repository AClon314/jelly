import {readFileSync, writeFileSync} from "fs";
import {FunctionInfo, ModuleInfo, PackageInfo} from "../analysis/infos";
import {addAll, getOrSet, locationToString, mapGetArray, mapGetMap} from "../misc/util";
import {ConstraintVar, NodeVar, ObjectPropertyVar} from "../analysis/constraintvars";
import {FragmentState} from "../analysis/fragmentstate";
import {NativeObjectToken, Token} from "../analysis/tokens";
import {isIdentifier} from "@babel/types";
import {VulnerabilityResults} from "../patternmatching/vulnerabilitydetector";
import {getVulnerabilityId, Vulnerability} from "../typings/vulnerabilities";
import {constraintVarToStringWithCode, funcToStringWithCode} from "./tostringwithcode";
import {join, sep} from "path";

export interface VisualizerGraphs {
    graphs: Array<{
        title?: string,
        kind: "callgraph" | "dataflow",
        info?: string,
        elements: Array<{data: Node | Edge}>,
        vulnerabilities?: Array<{
            title: string // TODO: include more information?
        } &
            Record<"package" | "module" | "function", {
                sources: Array<number>;
                targets: Array<number>;
            }>>
    }>;
}

export interface Node {
    id: number;
    kind: "package" | "module" | "function" | "variable";
    parent?: number;
    name?: string;
    fullName?: string;
    callWeight?: number; // number of incoming call edges (normalized to 0-100)
    tokenWeight?: number; // number of tokens (normalized to 0-100)
    callCount?: number; // number of incoming call edges
    tokenCount?: number; // number of tokens
    isEntry?: "true";
    isReachable?: "true";
}

export interface Edge {
    kind: "call" | "require" | "data";
    source: number;
    target: number;
    weight?: number;
}

function IdGenerator<T>() {
    const ids = new Map<T, number>();
    let next = 1;
    return (x: T) => {
        let t = ids.get(x);
        if (!t) {
            t = next++;
            ids.set(x, t);
        }
        return t;
    };
}

/**
 * Collection of nodes and edges.
 */
class Elements {

    readonly elements: Array<{data: Node | Edge}> = [];

    add(data: Node | Edge) {
        this.elements.push({data});
    }
}

/**
 * Finds the modules and functions that are reachable from the entries, and their packages.
 */
function getReachable(f: FragmentState): Set<PackageInfo | ModuleInfo | FunctionInfo> {
    const reachable = new Set<PackageInfo | ModuleInfo | FunctionInfo>();
    const w = new Array<ModuleInfo | FunctionInfo>();
    function reach(v: ModuleInfo | FunctionInfo) {
        if (!reachable.has(v)) {
            reachable.add(v);
            w.push(v);
        }
    }
    for (const e of f.a.entryFiles)
        reach(f.a.moduleInfosByPath.get(e)!);
    while (w.length > 0) {
        const v = w.pop()!;
        for (const n of [...f.requireGraph.get(v) || [], ...f.functionToFunction.get(v) || []])
            reach(n);
    }
    for (const m of f.a.moduleInfos.values())
        if (reachable.has(m))
            reachable.add(m.packageInfo);
    return reachable;
}

/**
 * Checks whether the constraint variable is "trivial", i.e., it has no tokens or it is a native object property
 * with only the native library value, or it represents 'undefined'.
 */
function isTrivialVar(v: ConstraintVar, ts: Iterable<Token>, size: number, redir: Map<ConstraintVar, Array<ConstraintVar>>): boolean {
    if (size > 1)
        return false;
    if (size === 0 || (v instanceof NodeVar && isIdentifier(v.node) && v.node.loc?.start.line === 0))
        return true;
    const first = ts[Symbol.iterator]().next().value;
    for (const w of [v, ...redir.get(v) ?? []])
        if (!(w instanceof ObjectPropertyVar && w.obj instanceof NativeObjectToken && first instanceof NativeObjectToken))
            return false;
    return true;
}

/**
 * Produces the call graph.
 */
function getVisualizerCallGraph(f: FragmentState, vulnerabilities: VulnerabilityResults): VisualizerGraphs {
    // count number of calls edges for all functions, modules and packages
    const functionCallCounts = new Map<FunctionInfo, number>();
    const moduleCallCounts = new Map<ModuleInfo, number>();
    const packageCallCounts = new Map<PackageInfo, number>();
    let maxFunctionCallCount = 1, maxModuleCallCount = 1, maxPackageCallCount = 1;
    for (const dsts of f.functionToFunction.values())
        for (const dst of dsts) {
            const fw = getOrSet(functionCallCounts, dst, () => 0) + 1;
            functionCallCounts.set(dst, fw);
            if (fw > maxFunctionCallCount)
                maxFunctionCallCount = fw;
            const fm = getOrSet(moduleCallCounts, dst.moduleInfo, () => 0) + 1;
            moduleCallCounts.set(dst.moduleInfo, fm);
            if (fm > maxModuleCallCount)
                maxModuleCallCount = fm;
            const fp = getOrSet(packageCallCounts, dst.packageInfo, () => 0) + 1;
            packageCallCounts.set(dst.packageInfo, fp);
            if (fp > maxPackageCallCount)
                maxPackageCallCount = fp;
        }
    for (const dsts of f.requireGraph.values())
        for (const dst of dsts) {
            const fm = getOrSet(moduleCallCounts, dst, () => 0) + 1;
            moduleCallCounts.set(dst, fm);
            if (fm > maxModuleCallCount)
                maxModuleCallCount = fm;
            const fp = getOrSet(packageCallCounts, dst.packageInfo, () => 0) + 1;
            packageCallCounts.set(dst.packageInfo, fp);
            if (fp > maxPackageCallCount)
                maxPackageCallCount = fp;
        }
    // prepare the new graph
    const reachable = getReachable(f);
    const id = IdGenerator<PackageInfo | ModuleInfo | FunctionInfo>();
    const e = new Elements();
    // add nodes for packages
    for (const p of f.a.packageInfos.values()) {
        const packageCallCount = packageCallCounts.get(p) ?? 0;
        e.add({
            id: id(p),
            kind: "package",
            name: p.name,
            fullName: p.toString(),
            callWeight: Math.round(100 * packageCallCount / maxPackageCallCount),
            callCount: packageCallCount,
            isEntry: p.isEntry ? "true" : undefined,
            isReachable: reachable.has(p) ? "true" : undefined
        });
    }

    function addFunction(n: FunctionInfo, parent: FunctionInfo | ModuleInfo) {
        const functionCallCount = functionCallCounts.get(n) ?? 0;
        e.add({
            id: id(n),
            kind: "function",
            parent: id(parent),
            name: (n.name ?? "<anon>") + ` ${locationToString(n.loc, false, true)}`,
            fullName: funcToStringWithCode(n),
            callWeight: Math.round(100 * functionCallCount / maxFunctionCallCount),
            callCount: functionCallCount,
            isReachable: reachable.has(n) ? "true" : undefined,
        });

        for (const fun of n.functions)
            // use parent instead of n to nest all functions directly in the module
            addFunction(fun, n);
    }

    // add nodes for modules
    for (const m of f.a.moduleInfos.values()) {
        const moduleCallCount = moduleCallCounts.get(m) ?? 0;
        e.add({
            id: id(m),
            kind: "module",
            parent: id(m.packageInfo),
            name: m.relativePath,
            fullName: m.toString(),
            callWeight: Math.round(100 * moduleCallCount / maxModuleCallCount),
            callCount: moduleCallCount,
            isEntry: m.isEntry ? "true" : undefined,
            isReachable: reachable.has(m) ? "true" : undefined
        });
        // add nodes for functions
        for (const fun of m.functions)
            addFunction(fun, m);
    }
    // add edges
    let numEdges = 0;
    for (const [src, dsts] of f.functionToFunction)
        for (const dst of dsts) {
            e.add({
                kind: "call",
                source: id(src),
                target: id(dst)
            });
            numEdges++;
        }
    for (const [src, dsts] of f.requireGraph)
        for (const dst of dsts) {
            e.add({
                kind: "require",
                source: id(src),
                target: id(dst)
            });
            numEdges++;
        }
    // add vulnerabilities
    let vuls;
    if (vulnerabilities.package && vulnerabilities.package.size > 0) {
        const relevant = new Set<Vulnerability>();
        const sources = new Map<Vulnerability, Record<"package" | "module" | "function", Set<PackageInfo | ModuleInfo | FunctionInfo>>>();
        const targets = new Map<Vulnerability, Record<"package" | "module" | "function", Set<PackageInfo | ModuleInfo | FunctionInfo>>>();
        function add(v: Vulnerability,
                     p: PackageInfo | ModuleInfo | FunctionInfo,
                     kind: "package" | "module" | "function",
                     m: Map<Vulnerability, Record<"package" | "module" | "function", Set<PackageInfo | ModuleInfo | FunctionInfo>>>) {
            let x = m.get(v);
            if (!x) {
                x = {package: new Set(), module: new Set(), function: new Set()};
                m.set(v, x);
            }
            x[kind].add(p);
        }
        for (const vs of vulnerabilities.package.values())
            addAll(vs, relevant);
        for (const [src, vs] of vulnerabilities.package)
            for (const v of vs)
                add(v, src, "package", sources);
        if (vulnerabilities.module)
            for (const [src, vs] of vulnerabilities.module)
                for (const v of vs)
                    add(v, src, "module", sources);
        if (vulnerabilities.function)
            for (const [src, vs] of vulnerabilities.function)
                for (const v of vs)
                    add(v, src, "function", sources);
        vuls = [];
        for (const v of relevant) {
            const x: NonNullable<VisualizerGraphs["graphs"][number]["vulnerabilities"]>[number] = {
                title: getVulnerabilityId(v),
                package: {sources: [], targets: []},
                module: {sources: [], targets: []},
                function: {sources: [], targets: []}
            };
            for (const kind of ["package", "module", "function"] as const) {
                const ss = sources.get(v);
                if (ss)
                    for (const s of ss[kind])
                        x[kind].sources.push(id(s));
                const ts = targets.get(v);
                if (ts)
                    for (const t of ts[kind])
                        x[kind].targets.push(id(t));
            }
            vuls.push(x);
        }
    }
    // return the graph
    return {
        graphs: [{
            kind: "callgraph",
            elements: e.elements,
            info: `Packages: ${f.a.packageInfos.size}\nModules: ${f.a.moduleInfos.size}\nFunctions: ${f.a.functionInfos.size}\nCall edges: ${numEdges}\nMax number of calls for packages: ${maxPackageCallCount}, modules: ${maxModuleCallCount}, functions: ${maxFunctionCallCount}`,
            vulnerabilities: vuls
        }]
    };
}

/**
 * Produces the dataflow graphs.
 */
function getVisualizerDataFlowGraphs(f: FragmentState): VisualizerGraphs {
    // count tokens for constraint variables, modules and packages and find the nontrivial constraint variables and their parents
    let maxVariableCount = 1, maxModuleTokenCount = 1, maxPackageTokenCount = 1;
    const moduleTokenCounts = new Map<ModuleInfo, number>();
    const packageTokenCounts = new Map<PackageInfo, number>();
    const nontrivialVars = new Set<ConstraintVar>(), anyEdges = new Set<ConstraintVar>();
    const parents = new Map<ConstraintVar, PackageInfo | ModuleInfo>();
    const redir = new Map<ConstraintVar, Array<ConstraintVar>>();
    for (const [v, w] of f.redirections)
        mapGetArray(redir, f.getRepresentative(w)).push(v);
    for (const [v, ts, size] of f.getAllVarsAndTokens()) {
        if (!isTrivialVar(v, ts, size, redir)) {
            nontrivialVars.add(v);
            const p = f.a.getConstraintVarParent(v);
            if (p)
                parents.set(v, p);
        }
        if (size - 1 > maxVariableCount)
            maxVariableCount = size - 1;
    }
    for (const [src, dsts] of f.subsetEdges)
        for (const dst of dsts) {
            if (nontrivialVars.has(dst))
                anyEdges.add(src);
            if (nontrivialVars.has(src))
                anyEdges.add(dst);
        }
    // prepare the graphs
    const id = IdGenerator<PackageInfo | ModuleInfo | FunctionInfo | ConstraintVar>();
    const res: VisualizerGraphs = {graphs: []};
    for (const p of f.a.packageInfos.values()) {
        // make a graph for each package
        let maxLocalVariableCount = 1, maxLocalModuleTokenCount = 1;
        const e = new Elements();
        const vars = new Set<ConstraintVar>();
        for (const [v, , size] of f.getAllVarsAndTokens())
            if (nontrivialVars.has(v) && anyEdges.has(v)) {
                const parent = parents.get(v);
                if (parent === p || parent instanceof ModuleInfo && parent.packageInfo === p) {
                    e.add({
                        id: id(v),
                        kind: "variable",
                        parent: id(parent),
                        fullName: constraintVarToStringWithCode(v),
                        tokenWeight: Math.floor(100 * (size - 1) / maxLocalVariableCount),
                        tokenCount: size
                    });
                    vars.add(v);
                    if (size - 1 > maxVariableCount)
                        maxVariableCount = size - 1;
                    if (size - 1 > maxLocalVariableCount)
                        maxLocalVariableCount = size - 1;
                    let pa;
                    if (parent instanceof ModuleInfo) {
                        pa = parent.packageInfo;
                        const fm = getOrSet(moduleTokenCounts, parent, () => 0) + 1;
                        moduleTokenCounts.set(parent, fm);
                        if (fm > maxModuleTokenCount)
                            maxModuleTokenCount = fm;
                        if (fm > maxLocalModuleTokenCount)
                            maxLocalModuleTokenCount = fm;
                    } else
                        pa = parent;
                    const pm = getOrSet(packageTokenCounts, pa, () => 0) + 1;
                    packageTokenCounts.set(pa, pm);
                    if (pm > maxPackageTokenCount)
                        maxPackageTokenCount = pm;
                }
            }
        let numFunctions = 0;
        for (const m of p.modules.values()) {
            const moduleTokenCount = moduleTokenCounts.get(m) ?? 0;
            e.add({
                id: id(m),
                kind: "module",
                parent: id(m.packageInfo),
                name: m.relativePath,
                fullName: m.toString(),
                tokenWeight: Math.floor(100 * (moduleTokenCount - 1) / maxLocalModuleTokenCount),
                tokenCount: moduleTokenCount
            });
            numFunctions += m.functions.size;
        }
        for (const [src, dsts] of f.subsetEdges)
            for (const dst of dsts)
                if (nontrivialVars.has(src) && nontrivialVars.has(dst) && anyEdges.has(src) && anyEdges.has(dst) && vars.has(src) && vars.has(dst))
                    e.add({
                        kind: "data",
                        source: id(src),
                        target: id(dst)
                    });
        res.graphs.push({
            title: p.toString(),
            kind: "dataflow",
            elements: e.elements,
            info: `Modules: ${p.modules.size}\nFunctions: ${numFunctions}\nVariables: ${vars.size}\nMax number of values for modules: ${maxLocalModuleTokenCount}, variables: ${maxLocalVariableCount}`
        });
    }
    res.graphs.sort((p1: {title?: string}, p2: {title?: string}) => p1.title!.localeCompare(p2.title!));
    // prepare an overview graph
    const e = new Elements();
    // add the packages
    for (const p of f.a.packageInfos.values()) {
        const packageTokenCount = packageTokenCounts.get(p) ?? 0;
        e.add({
            id: id(p),
            kind: "package",
            name: p.name,
            fullName: p.toString(),
            tokenWeight: Math.floor(100 * (packageTokenCount - 1) / maxPackageTokenCount),
            tokenCount: packageTokenCount
        });
    }
    // add the modules
    for (const m of f.a.moduleInfos.values()) {
        const moduleTokenCount = moduleTokenCounts.get(m) ?? 0;
        e.add({
            id: id(m),
            kind: "module",
            parent: id(m.packageInfo),
            name: m.relativePath,
            fullName: m.toString(),
            tokenWeight: Math.floor(100 * (moduleTokenCount - 1) / maxModuleTokenCount),
            tokenCount: moduleTokenCount
        });
    }
    // add the edges
    const numEdges = new Map<number, Map<number, number>>();
    let maxNumEdges = 1;
    for (const [src, dsts] of f.subsetEdges) {
        const srcParent = parents.get(src);
        if (srcParent)
        for (const dst of dsts) {
            if (nontrivialVars.has(src) && nontrivialVars.has(dst) && anyEdges.has(src) && anyEdges.has(dst)) {
                const dstParent = parents.get(dst);
                if (dstParent) {
                    const source = id(srcParent), target = id(dstParent);
                    if (source !== target) {
                        const m = mapGetMap(numEdges, source);
                        const w = getOrSet(m, target, () => 0) + 1;
                        m.set(target, w);
                        if (w > maxNumEdges)
                            maxNumEdges = w;
                    }
                }
            }
        }
    }
    for (const [src, m] of numEdges)
        for (const [dst, n] of m)
            e.add({
                kind: "data",
                source: src,
                target: dst,
                weight: Math.floor(100 * n / maxNumEdges)
            });
    res.graphs.unshift({
        title: "Packages and modules",
        kind: "dataflow",
        elements: e.elements,
        info: `Packages: ${f.a.packageInfos.size}\nModules: ${f.a.moduleInfos.size}\nFunctions: ${f.a.functionInfos.size}\nMax number of values for packages: ${maxPackageTokenCount}, modules: ${maxModuleTokenCount}, variables: ${maxVariableCount}`
    });
    return res;
}

/**
 * Expands the template's `<!--#include visualizer/foo.js-->` markers.
 *
 * Every include path is relative to `resources/` (also for nested includes). Fragments are
 * written from column 0; the marker's own indentation is prepended to each non-empty line so
 * the expanded output keeps the exact layout of the original single-file template. A missing
 * fragment throws instead of silently leaving a hole in the generated HTML.
 */
function expandIncludes(text: string, resourcesDir: string): string {
    return text.replace(/^([ \t]*)<!--#include[ \t]+(\S+?)[ \t]*-->[ \t]*$/gm, (_match, indent: string, file: string) => {
        const path = join(resourcesDir, file);
        let fragment: string;
        try {
            fragment = readFileSync(path, "utf-8");
        } catch (e) {
            throw new Error(`visualizer.html: cannot include '${file}' (${path}): ${(e as Error).message}`);
        }
        fragment = expandIncludes(fragment, resourcesDir);
        // Drop the fragment's trailing newline: the include marker's own line break takes over,
        // so the number of lines in the expansion is exactly the fragment's line count.
        if (fragment.endsWith("\n"))
            fragment = fragment.slice(0, -1);
        return fragment.split("\n").map(line => line.length === 0 ? line : indent + line).join("\n");
    });
}

function writeVisualizerHtml(filename: string, g: VisualizerGraphs | undefined, dataUrl?: string) {
    const resourcesDir = __dirname + `${sep}..${sep}..${sep}resources`;
    const templateFile = resourcesDir + `${sep}visualizer.html`;
    // Expand includes first: the `$DATA` / `$DATA_URL` placeholders live in fragments too.
    const t = expandIncludes(readFileSync(templateFile, "utf-8"), resourcesDir);
    // Substitute the whole statements, not the bare `$DATA` / `$DATA_URL` tokens: the template's
    // documentation comments also mention them.
    const urlStatement = "const DATA_URL = $DATA_URL;";
    const i = t.indexOf(urlStatement);
    if (i < 0)
        throw new Error(`visualizer.html is missing '${urlStatement}'`);
    const withUrl = t.substring(0, i) + `const DATA_URL = ${JSON.stringify(dataUrl ?? null)};` + t.substring(i + urlStatement.length);
    const dataStatement = "const INLINE_DATA = $DATA;";
    const j = withUrl.indexOf(dataStatement);
    if (j < 0)
        throw new Error(`visualizer.html is missing '${dataStatement}'`);
    // string.replace doesn't like very long strings (and would interpret $ patterns in the data)
    const res = withUrl.substring(0, j) + `const INLINE_DATA = ${g === undefined ? "null" : JSON.stringify(g)};` + withUrl.substring(j + dataStatement.length);
    writeFileSync(filename, res);
}

/**
 * Exports the call graph as an HTML file.
 * When dataUrl is given, the page fetches that URL (a raw call graph JSON, as written by `-j`)
 * and builds the graph itself, so the file stays small and can be regenerated independently of
 * the analysis. Otherwise the data is embedded as before.
 */
export function exportCallGraphHtml(f: FragmentState, filename: string, vulnerabilities: VulnerabilityResults, dataUrl?: string) {
    if (dataUrl !== undefined)
        writeVisualizerHtml(filename, undefined, dataUrl);
    else
        writeVisualizerHtml(filename, getVisualizerCallGraph(f, vulnerabilities));
}

/**
 * Exports the data-flow graphs as an HTML file.
 */
export function exportDataFlowGraphHtml(f: FragmentState, filename: string) {
    writeVisualizerHtml(filename, getVisualizerDataFlowGraphs(f));
}
