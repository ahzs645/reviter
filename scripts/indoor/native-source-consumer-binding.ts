/** CLI-only complete local source closure binding. Never writes an app binding. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
const hash = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
export function originalSourceConsumerBinding(repositoryRoot: string, entryPoints: string[]) {
    const files = new Map<string, string>();
    function visit(file: string) {
        const name = path.relative(repositoryRoot, file).replaceAll("\\", "/");
        if (files.has(name))
            return;
        const bytes = readFileSync(file);
        files.set(name, hash(bytes));
        if (!/\.(?:ts|tsx|js|mjs)$/.test(file))
            return;
        const source = ts.createSourceFile(file, bytes.toString(), ts.ScriptTarget.Latest, true);
        function reference(node: ts.Node | undefined, asset = false) {
            if (!node || !ts.isStringLiteralLike(node) || !node.text.startsWith("."))
                return;
            const base = path.resolve(path.dirname(file), node.text), target = [base, ...[".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx"].map(x => base + x)].find(p => existsSync(p) && statSync(p).isFile());
            if (!target) {
                if (asset)
                    return;
                throw Error(`Missing source consumer dependency ${node.text} in ${name}`);
            }
            visit(target);
        }
        function scan(node: ts.Node) {
            if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
                reference(node.moduleSpecifier);
            if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
                reference(node.arguments[0]);
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL")
                reference(node.arguments?.[0], true);
            ts.forEachChild(node, scan);
        }
        scan(source);
    }
    for (const entry of entryPoints)
        visit(path.resolve(repositoryRoot, entry));
    visit(path.resolve(repositoryRoot, "package-lock.json"));
    const modules = [...files].sort(([a], [b]) => a.localeCompare(b));
    return { format: "original-source-cli-consumer-closure-v1", sha256: hash(JSON.stringify(["original-source-cli-consumer-closure-v1", modules])), modules };
}
