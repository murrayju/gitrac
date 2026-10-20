#!/bin/bash
# Create the demo repository that the recordings use.
# Usage: setup-demo.sh <dir>  (the directory is deleted first)
set -euo pipefail

demoDir="${1:?usage: setup-demo.sh <dir>}"
templateDir="$(cd "$(dirname "$0")/demo-project" && pwd)"

rm -rf "$demoDir"
mkdir -p "$demoDir"
cp -R "$templateDir/." "$demoDir"
cd "$demoDir"

git init -q -b main
git config user.name 'Sam Rivera'
git config user.email 'sam@example.com'
git add -A
git commit -q -m 'Initial commit'

gitrac init > /dev/null
sed -i.bak -e 's/^defaultStatus: backlog/defaultStatus: todo/' \
  -e 's/^assignees: \[\]/assignees:\n  - name: Sam Rivera\n    email: sam@example.com/' .issues/config.yaml
rm .issues/config.yaml.bak
git commit -q -am 'Configure the issue tracker'
gitrac create -t 'Pages show one note too few' -p medium -l bug \
  -d 'With a page size of 10, `notes` shows 9 notes per page.' > /dev/null
gitrac create -t 'Add a --version flag' -p low -l feature \
  -d '`notes --version` should print the version from `package.json`.' > /dev/null
gitrac create -t 'Sync notes across devices' -p medium -l feature -s backlog -a sam@example.com \
  -d 'Store notes in a shared location so that they are the same on every machine.' > /dev/null
gitrac create -t 'Export notes as markdown' -p low -l feature -s backlog \
  -d 'Add `notes export` to write all notes to a markdown file.' > /dev/null
gitrac link 4 --blocked-by 3 > /dev/null
