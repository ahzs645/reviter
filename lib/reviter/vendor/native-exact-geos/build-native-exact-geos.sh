#!/usr/bin/env sh
set -eu
# GEOS LGPL source archive stays unmodified; two audited diagnostic noder files
# are copied into a private build. Original project geometry is never edited.
archive=$1
build_root=$2
vendor_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
actual=$(shasum -a 256 "$archive" | cut -d ' ' -f 1)
[ "$actual" = "47ec83ff334d672b9e4426695f15da6e6368244214971fabf386ff8ef6df39e4" ] || { echo 'GEOS source checksum mismatch' >&2; exit 1; }
mkdir -p "$build_root"
tar -xjf "$archive" -C "$build_root"
cp "$vendor_dir/SnappingPointIndex.h" "$build_root/geos-3.13.0/include/geos/noding/snap/"
cp "$vendor_dir/SnappingPointIndex.cpp" "$build_root/geos-3.13.0/src/noding/snap/"
cp "$vendor_dir/SnappingIntersectionAdder.cpp" "$build_root/geos-3.13.0/src/noding/snap/"
emcmake cmake -S "$build_root/geos-3.13.0" -B "$build_root/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DCMAKE_CXX_FLAGS=-fexceptions
cmake --build "$build_root/build" --target geos --parallel 6
em++ "$vendor_dir/native-exact-geos.cpp" "$build_root/build/lib/libgeos.a" -I"$build_root/geos-3.13.0/include" -I"$build_root/build/include" -O3 -fexceptions -sDISABLE_EXCEPTION_CATCHING=0 -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sSTACK_SIZE=1048576 -sENVIRONMENT=web,worker,node -sEXPORTED_FUNCTIONS='["_native_overlay","_native_union","_native_difference_sequence","_native_bounded_snap_union","_native_bounded_snap_overlay","_native_bounded_snap_sequence","_native_snap_records","_native_last_error","_malloc","_free"]' -sEXPORTED_RUNTIME_METHODS='["UTF8ToString","stringToUTF8","lengthBytesUTF8"]' -o "$build_root/native-exact-geos.mjs"
shasum -a 256 "$build_root/native-exact-geos.wasm"
