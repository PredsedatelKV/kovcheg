"""List the local bundles and artwork required before the entry screen closes."""
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote, unquote

release = Path(sys.argv[1])
static = Path(sys.argv[2])
suffixes = {".js", ".css", ".json", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".avif", ".gif",
            ".wav", ".ogg", ".mp3", ".m4a", ".woff", ".woff2"}
release_url = "/static/releases/" + release.name + "/"
generated = {"preload.json", "asset-versions.json"}
references = re.compile(r"""(/static/[^\s"'<>\x60{}()]+\.(?:png|jpg|jpeg|webp|svg|gif|avif|wav|mp3|ogg|m4a|css|woff2?)(?:\?[^\s"'<>\x60{}()]+)?)""", re.I)
paths = set()
for file in release.rglob("*"):
    if not file.is_file():
        continue
    relative = file.relative_to(release).as_posix()
    if file.suffix.lower() in suffixes or relative.endswith(".bin.gz"):
        if relative not in generated:
            paths.add(relative)
    if file.suffix in {".js", ".css", ".html"}:
        for source in references.findall(file.read_text(encoding="utf-8")):
            bare = source.split("?", 1)[0]
            if bare.startswith(release_url):
                source = source.removeprefix(release_url)
                local = release / bare.removeprefix(release_url)
            else:
                local = static / bare.removeprefix("/static/")
            if local.is_file():
                paths.add(source)
for file in (static / "img").rglob("*"):
    if file.is_file() and file.suffix.lower() in suffixes:
        paths.add("/static/" + file.relative_to(static).as_posix())
# Hashed/gzip and raw variants are selected at startup for the running WebView.
(release / "preload.json").write_text(json.dumps(sorted(paths), separators=(",", ":")) + "\n", encoding="utf-8")
versions = {}
hashes = {}
raw_models = {url.removesuffix(".gz") for url in paths if url.endswith(".bin.gz")}
shared = {
    "/static/" + file.relative_to(static).as_posix()
    for root in ("uploads", "audio")
    for file in (static / root).rglob("*")
    if file.is_file() and file.suffix.lower() in suffixes
}
for url in sorted(paths | raw_models | shared | {"preload.json"}):
    path, query, version = url.partition("?")
    source = unquote(path)
    file = (static / source.removeprefix("/static/")) if source.startswith("/static/") else (release / source)
    if not file.is_file():
        continue
    if file not in hashes:
        hashes[file] = hashlib.sha256(file.read_bytes()).hexdigest()
    versions[quote(source, safe="/") + query + version] = hashes[file]
(release / "asset-versions.json").write_text(json.dumps(versions, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"{len(paths)} bundled and static assets")
