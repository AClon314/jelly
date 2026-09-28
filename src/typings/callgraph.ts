/**
 * Call graph created either statically or dynamically.
 *
 * Each source location has the format "<file index>:<start line>:<start column>:<end line>:<end column>".
 * Each function index, function location, call index and call location is assumed to be unique.
 * The edge arrays are assumed not to contain duplicate pairs.
 *
 * Be aware that some call edges may or may not be included depending on how the call graph is created:
 * - implicit calls to getters/setters and toString/valueOf
 * - calls to/from native functions, including 'eval', and event handlers
 * - calls to 'require' and import declarations
 */
import {LocationJSON} from "../misc/util";

export type CallGraph = { // TODO: represent special call edges separately from ordinary call edges?

    /**
     * Entry files (relative to basedir).
     */
    entries?: Array<string>,

    /**
     * If set to true, only files listed in 'files' have been analyzed.
     */
    ignoreDependencies?: boolean,

    /**
     * Packages that have been selected for inclusion (default: all).
     */
    includePackages?: Array<string>,

    /**
     * Packages that have been selected for exclusion (default: none).
     */
    excludePackages?: Array<string>,

    /**
     * Time stamp of creation.
     */
    time?: string,

    /**
     * Array of files (relative to basedir).
     * The position in the array defines the file index.
     */
    files: Array<string>,

    /**
     * Indices and source locations of functions.
     */
    functions: {
        [index: number]: LocationJSON;
    },

    /**
     * Names of the entries in 'functions', by the same index space: the module path for a module
     * entry and the function name (or "<anon>") for a function entry.
     *
     * Emitted by saveCallGraph (the CLI `-j` path). Optional so that older files and the
     * callGraphToJSON (server) path remain valid; consumers should fall back to the index.
     */
    functionNames?: Array<string>;

    /**
     * Indices in 'functions' that denote a whole module rather than a single function.
     * Emitted by saveCallGraph. Together with 'functionNames' this is what a consumer needs to
     * rebuild the package -> module -> function hierarchy of the visualizer without the analysis.
     */
    moduleNodes?: Array<number>;

    /**
     * Indices and source locations of calls.
     */
    calls: {
        [index: number]: LocationJSON;
    },

    /**
     * Caller-callee edges, function to function.
     */
    fun2fun: Array<[number, number]>;

    /**
     * The subset of 'fun2fun' that represents module loading (require/import) rather than a
     * function call. The edges are also present in 'fun2fun' so that existing consumers are
     * unaffected; this list exists so consumers can tell the two kinds apart (the visualizer
     * renders them differently). Only emitted when require edges are enabled (the default).
     */
    requireEdges?: Array<[number, number]>;

    /**
     * Caller-callee edges, call site to function.
     */
    call2fun: Array<[number, number]>;

    /**
     * Source locations of functions that should be ignored when comparing call graphs.
     * This is used for skipping spurious functions that appear in dynamic call graph construction
     * but are not known to be spurious until running static call graph construction.
     */
    ignore?: Array<LocationJSON>;
}
