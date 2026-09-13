#!/usr/bin/env python3
"""Build the #103 reference probe on macOS with Xcode clang, without GUI/Vulkan.

Usage: python3 docs/probes/build_ares_probe.py <ares checkout> <output directory>
The reference checkout is read-only; generated sources and objects go in output.
"""
import concurrent.futures
import pathlib
import subprocess
import sys

REVISION = "b15d4d378c0ae59628d914efba1dfac81b07f88f"


def main():
    if len(sys.argv) != 3 or sys.platform != "darwin":
        raise SystemExit(__doc__)
    source = pathlib.Path(sys.argv[1]).resolve(strict=True)
    output = pathlib.Path(sys.argv[2]).resolve()
    revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if revision != REVISION:
        raise SystemExit(f"Expected ares {REVISION}, found {revision}")
    if subprocess.check_output(["git", "-C", str(source), "diff", "HEAD", "--name-only"], text=True).strip():
        raise SystemExit("Use an unmodified reference checkout")
    output.mkdir(parents=True, exist_ok=True)

    core = (source / "ares/ares/ares.cpp.in").read_text()
    core = core.replace("#include <ares/resource/resource.cpp>\n", "")  # no embedded resources used by N64
    (output / "ares-core.cpp").write_text(core)
    system = (source / "ares/n64/system/system.cpp").read_text()
    # System::run assumes Vulkan in the desktop build. The probe drives CPU
    # instructions directly, so this frontend-only load is never used.
    assert system.count("    vulkan.load(node);") == 1
    system = system.replace("    vulkan.load(node);", "    #if defined(VULKAN)\n    vulkan.load(node);\n    #endif")
    system = system.replace('#include "serialization.cpp"', '#include <n64/system/serialization.cpp>')
    (output / "system.cpp").write_text(system)
    n64 = (source / "ares/n64/n64.cpp").read_text()
    n64 = n64.replace("#include <n64/system/system.cpp>", '#include "system.cpp"')
    (output / "n64-core.cpp").write_text(n64)

    sources = [
        pathlib.Path(__file__).with_name("ares_battletanx.cpp").resolve(),
        output / "ares-core.cpp", output / "n64-core.cpp",
        source / "ares/ares/memory/fixed-allocator.cpp",
        source / "ares/component/processor/sm5k/sm5k.cpp",
        source / "nall/nall/nall.cpp", source / "nall/nall/sljitAllocator.cpp",
        source / "libco/libco.c", source / "thirdparty/sljit/sljit_src/sljitLir.c",
    ]
    includes = [f"-I{source / p}" for p in [".", "ares", "nall", "thirdparty"]]

    def compile_one(item):
        index, path = item
        obj = output / f"{index}.o"
        if path.suffix == ".c":
            command = ["clang", "-O2", "-DSLJIT_CONFIG_AUTO=1"]
        else:
            command = ["clang++", "-std=c++20", "-O2", "-DBUILD_RELEASE", "-DCORE_N64", "-Wno-everything"]
        subprocess.run(command + includes + ["-c", str(path), "-o", str(obj)], check=True)
        print(f"Compiled {path.name}", flush=True)
        return str(obj)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        objects = list(pool.map(compile_one, enumerate(sources)))
    binary = output / "ares-battletanx"
    subprocess.run(["clang++", *objects, "-o", str(binary), "-framework", "Foundation",
                    "-framework", "Security", "-framework", "CoreFoundation"], check=True)
    print(binary)


if __name__ == "__main__":
    main()
