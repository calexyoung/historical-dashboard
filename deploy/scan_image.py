"""Look inside a Docker image for things that must never be in one (PLAN 6.1, 'Build and CI').

    python deploy/scan_image.py IMAGE NEEDLE [NEEDLE ...]

Reads every layer of IMAGE (`docker save`), and fails if any file's bytes contain a NEEDLE, or if
any path inside the app directory belongs to a generated release, the store or v1's data files.
It scans layers, not the final filesystem, so a file added and later deleted is still found.
"""
import io
import subprocess
import sys
import tarfile
import tempfile

# Under /app only: the base image has its own /var and so on.
FORBIDDEN = ("app/var/", "app/data/", "app/dist/", "app/web/", "app/.git/", "app/fixtures/", "app/tests/")


def scan_layer(layer: tarfile.TarFile, needles: list[bytes], found: list[str]) -> int:
    files = 0
    for member in layer.getmembers():
        path = member.name.lstrip("./")
        if path.startswith(FORBIDDEN):
            found.append(f"forbidden path in a layer: /{path}")
        if not member.isfile():
            continue
        files += 1
        data = layer.extractfile(member).read()
        for needle in needles:
            if needle in data:
                found.append(f"{needle.decode(errors='replace')!r} found in /{path}")
    return files


def scan(image: str, needles: list[bytes]) -> list[str]:
    found: list[str] = []
    files = 0
    with tempfile.NamedTemporaryFile(suffix=".tar") as saved:
        subprocess.run(["docker", "save", image, "-o", saved.name], check=True)
        with tarfile.open(saved.name) as image_tar:
            for blob in image_tar.getmembers():
                if not blob.isfile():
                    continue
                data = io.BytesIO(image_tar.extractfile(blob).read())
                try:
                    with tarfile.open(fileobj=data) as layer:
                        files += scan_layer(layer, needles, found)
                except tarfile.ReadError:
                    continue  # a JSON manifest or config, not a layer
    if files < 1000:
        found.append(f"only {files} files were scanned: the image was not read properly")
    print(f"{image}: scanned {files} files in every layer")
    return found


if __name__ == "__main__":
    image, *needles = sys.argv[1:]
    problems = scan(image, [n.encode() for n in needles])
    for problem in problems:
        print("LEAK:", problem, file=sys.stderr)
    sys.exit(1 if problems else 0)
