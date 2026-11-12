"""A User note as a file (PLAN 5; CONTEXT.md): ``notes/{user}/{id}.md``.

One user's own remark on a Claim, a Series or a Topic, carrying that user's name. It is kept
outside ``content/`` and the content compiler has no door for it, so it is in no Release of
either Profile in v2.0 (showing one on a public Surface waits for Alex: D7(d), M44). ``atlas
add note`` writes one and ``atlas check`` holds it to this format; nothing reads its words. A
note may hold a judgment; that is why it is the user's and not Macro Atlas's.
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

import yaml

from . import events as E

NOTES_DIR = E.ROOT / "notes"
ABOUT = ("claim", "series", "topic")
FIELDS = ("id", "user", "about", "created", "status")
_USER = re.compile(r"[a-z0-9][a-z0-9_-]{0,31}")
_ID = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*")
_TARGET = {"series": re.compile(r"[a-z][a-z0-9_]{0,63}"), "claim": re.compile(r"[a-z0-9]+(-[a-z0-9]+)*"),
           "topic": re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")}


def about_problem(kind: object, target: object, series: set[str] | None) -> str | None:
    """Why a note cannot be about ``kind:target``, or None. A Series must be in the Catalog;
    Claims and Topics are not files yet (M20, M23), so theirs is held to its shape only."""
    if kind not in ABOUT:
        return "a note is about a claim, series or topic (KIND:ID)"
    if not isinstance(target, str) or not _TARGET[kind].fullmatch(target):
        return f"{target!r} is not the id of a {kind}"
    if kind == "series" and series is not None and target not in series:
        return f"it is about the Series {target}, which is not in the catalog"
    return None


def serialise(note: dict) -> str:
    return "\n".join([
        "---", f"id: {E._quoted(note['id'])}", f"user: {E._quoted(note['user'])}", "about:",
        f"  kind: {note['about']['kind']}", f"  id: {E._quoted(note['about']['id'])}",
        f"created: {E._quoted(note['created'])}", "status: draft", "---", "", note["text"].strip(), ""])


def read_note(body: bytes, user: str, name: str, series: set[str] | None = None) -> list[str]:
    """Every reason the bytes of ``notes/{user}/{name}`` are not a User note. Empty: it is one."""
    try:
        parts = E.split(body.decode("utf-8"))
    except UnicodeDecodeError:
        return ["the file is not UTF-8 text"]
    if parts is None:
        return ["the file does not begin with front matter between two --- lines"]
    try:
        front = yaml.load(parts[0], Loader=E._Strict)  # noqa: S506 - a SafeLoader subclass
    except yaml.YAMLError as error:
        return [f"the front matter cannot be read: {str(error).splitlines()[0][:160]}"]
    if not isinstance(front, dict):
        return ["the front matter is not a list of names and values"]
    problems = [f"it has a field a note does not have: {name}" for name in sorted(set(front) - set(FIELDS))]
    problems += [f"it has no {name}" for name in FIELDS if name not in front]
    if problems:
        return problems
    if not isinstance(front["user"], str) or not _USER.fullmatch(front["user"]):
        problems.append("its user is not a short name in lower case")
    elif front["user"] != user:
        problems.append(f"it says it is {front['user']}'s and is in {user}'s folder")
    if not isinstance(front["id"], str) or not _ID.fullmatch(front["id"]):
        problems.append("its id is not a day and a slug")
    elif name != f"{front['id']}.md":
        problems.append(f"the file is not named for its id (it would be {front['id']}.md)")
    try:
        if not isinstance(front["created"], str) or date.fromisoformat(front["created"]).isoformat() != front["created"]:
            raise ValueError
    except ValueError:
        problems.append("its created is not a day")
    if front["status"] != "draft":
        problems.append("its status is not draft: a note is never published in v2.0")
    about = front["about"]
    if not isinstance(about, dict) or set(about) != {"kind", "id"}:
        problems.append("its about is not a kind and an id")
    else:
        said = about_problem(about["kind"], about["id"], series)
        if said:
            problems.append(said)
    if not parts[1]:
        problems.append("it has no text")
    return problems


def note_files(directory: Path | None = None) -> list[Path]:
    directory = NOTES_DIR if directory is None else Path(directory)
    return sorted(path for path in directory.rglob("*") if path.is_file()) if directory.is_dir() else []
