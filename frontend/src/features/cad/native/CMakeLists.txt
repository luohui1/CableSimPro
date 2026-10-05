cmake_minimum_required(VERSION 3.20)
project(cablesim_occt_viewer LANGUAGES CXX)
file(TO_CMAKE_PATH "${OCCT_SHADERS}" OCCT_SHADERS)
file(COPY "${OCCT_SHADERS}" DESTINATION "${CMAKE_CURRENT_BINARY_DIR}")
find_package(OpenCASCADE REQUIRED)
add_executable(occt-viewer viewer.cpp)
target_include_directories(occt-viewer PRIVATE "${OpenCASCADE_INCLUDE_DIR}")
target_link_directories(occt-viewer PRIVATE "${OpenCASCADE_LIBRARY_DIR}")
target_compile_features(occt-viewer PRIVATE cxx_std_17)
target_compile_options(occt-viewer PRIVATE -O2 -fexceptions)
target_link_libraries(occt-viewer PRIVATE TKV3d TKOpenGles TKService TKHLR TKMesh TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel)
target_link_options(occt-viewer PRIVATE
  --bind --no-entry -O2 -fexceptions
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createCadModule
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sSTACK_SIZE=8388608
  -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2
  -sGL_ENABLE_GET_PROC_ADDRESS=1 -sDISABLE_EXCEPTION_CATCHING=0
  -sENVIRONMENT=web
  "SHELL:--embed-file Shaders@/occt/shaders")
set_target_properties(occt-viewer PROPERTIES SUFFIX ".js")

