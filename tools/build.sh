SCRIPT_NAME="${0##*/}"
SCRIPT_DIR="${0%/*}"

if test "$SCRIPT_DIR" == "." ; then
  SCRIPT_DIR="$PWD"
elif test "${SCRIPT_DIR:0:1}" != "/" ; then
  SCRIPT_DIR="$PWD/$SCRIPT_DIR"
fi

PROJECT_DIR="$SCRIPT_DIR/.."

java -jar "$PROJECT_DIR/../closure-compiler/compiler.jar" \
  --compilation_level SIMPLE_OPTIMIZATIONS \
	--js "$PROJECT_DIR/src/n64.js" \
	--js "$PROJECT_DIR/src/r4300.js" \
	--js "$PROJECT_DIR/src/debugger.js" \
	--js "$PROJECT_DIR/src/disassemble.js" \
  --js "$PROJECT_DIR/src/hle.js" \
	--js "$PROJECT_DIR/src/romdb.js" \
	--js "$PROJECT_DIR/src/sync.js" \
  --create_source_map "$PROJECT_DIR/n64.min.js.map" \
  --source_map_format=V3 \
	--js_output_file "$PROJECT_DIR/n64.min.js"


echo "//@ sourceMappingURL=n64.min.js.map" >> "$PROJECT_DIR/n64.min.js"
