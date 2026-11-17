#!/bin/bash
# Colab setup for the second vestibule rebuild (same producer trees as the first run).
set -euo pipefail
export TZ=UTC HUSKY=0 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
U=/content/upload; W=/content/unbc; mkdir -p $W
node --version 2>/dev/null | grep -qx v22.22.0 || (curl -fsSL https://nodejs.org/dist/v22.22.0/node-v22.22.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1)
node --version; which rsync zstd >/dev/null || apt-get -qq install -y rsync zstd > /dev/null
declare -A BASE=( [openindoormaps]=7c27b67568fe04a060af44fde727efb3ced39df4 [reviter]=cb140e46d06d8fa728b059ab6068d58fb55e9ea9 )
declare -A TREE=( [openindoormaps]=1f2048d52de54fda50583d0dc9d22abfba7fe222 [reviter]=7ff09c0a58ef37c34566abc01c9cb737e771b101 )
for repo in openindoormaps reviter; do
  [ -d $W/$repo ] || git clone -q https://github.com/ahzs645/$repo.git $W/$repo
  if [ "$(git -C $W/$repo rev-parse 'HEAD^{tree}')" != "${TREE[$repo]}" ]; then
    git -C $W/$repo checkout -q --detach ${BASE[$repo]}
    if [ $repo = openindoormaps ]; then P=$(ls $U/000*.patch); else P=$(ls $U/r000*.patch); fi
    git -c user.name="UNBC owner" -c user.email=owner@localhost -C $W/$repo am -q $P
  fi
  [ "$(git -C $W/$repo rev-parse 'HEAD^{tree}')" = "${TREE[$repo]}" ] || { echo "TREE MISMATCH $repo"; exit 1; }
  echo "$repo tree ok $(git -C $W/$repo rev-parse HEAD)"
done
(cd $W/reviter && [ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error) &
(cd $W/openindoormaps && [ -d node_modules ] || npm ci --no-audit --no-fund --loglevel=error) &
python3 -I $W/openindoormaps/docs/continuation/unbc-20261021/recompile/fetch-inputs.py $W/inputs
wait
ls -la $W/inputs
echo SETUP_DONE
