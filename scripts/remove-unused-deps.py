#!/usr/bin/env python3
"""
Remove verified-unused dependencies from package.json.

Verified unused (0 imports anywhere in src/):
  - 23 @radix-ui/react-* packages
  - lodash
  - react-markdown

Kept (used by src/components/ui/{button,separator,sheet,dialog,label}.jsx,
which themselves are currently unused but kept as scaffolding):
  - @radix-ui/react-slot, @radix-ui/react-separator,
    @radix-ui/react-dialog, @radix-ui/react-label
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG_PATH = ROOT / "package.json"

REMOVE = {
    # Radix UI — verified 0 imports in src/
    "@radix-ui/react-accordion",
    "@radix-ui/react-alert-dialog",
    "@radix-ui/react-aspect-ratio",
    "@radix-ui/react-avatar",
    "@radix-ui/react-checkbox",
    "@radix-ui/react-collapsible",
    "@radix-ui/react-context-menu",
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-hover-card",
    "@radix-ui/react-menubar",
    "@radix-ui/react-navigation-menu",
    "@radix-ui/react-popover",
    "@radix-ui/react-progress",
    "@radix-ui/react-radio-group",
    "@radix-ui/react-scroll-area",
    "@radix-ui/react-select",
    "@radix-ui/react-slider",
    "@radix-ui/react-switch",
    "@radix-ui/react-tabs",
    "@radix-ui/react-toast",
    "@radix-ui/react-toggle",
    "@radix-ui/react-toggle-group",
    "@radix-ui/react-tooltip",
    # Generic libs — verified 0 imports in src/
    "lodash",
    "react-markdown",
}

pkg = json.loads(PKG_PATH.read_text())
deps = pkg.get("dependencies", {})

removed = []
missing = []
for name in sorted(REMOVE):
    if name in deps:
        removed.append(name)
        del deps[name]
    else:
        missing.append(name)

# Write back with 2-space indent + trailing newline (matches npm style)
PKG_PATH.write_text(json.dumps(pkg, indent=2) + "\n")

print(f"Removed {len(removed)} unused dependencies:")
for r in removed:
    print(f"  - {r}")
if missing:
    print(f"\nNote: {len(missing)} packages were not present (already removed):")
    for m in missing:
        print(f"  - {m}")

print(f"\nFinal dependency count: {len(deps)}")
