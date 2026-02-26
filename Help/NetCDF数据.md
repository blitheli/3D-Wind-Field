# NetCDF 数据格式说明

## 1. 概述

本项目使用 **NetCDF V3 格式** 的气象数据文件来实现 3D 风场粒子动画可视化。数据文件位于 `data/demo.nc`。

## 2. NetCDF 简介

**NetCDF**（Network Common Data Form）是一种用于存储科学数据的自描述、机器无关的数据格式，由 UCAR Unidata 开发维护，广泛应用于气象、海洋、气候等领域。

### 版本区别

| 版本 | 底层格式 | 浏览器支持 | 本项目支持 |
|------|----------|------------|------------|
| NetCDF-3 (Classic) | 自有格式 | ✅ netcdfjs | ✅ 必须使用 |
| NetCDF-4 | HDF5 | ❌ 无 | ❌ 不支持 |

> ⚠️ **重要**：本项目**只支持 NetCDF V3 格式**，不支持 V4、HDF5、GRIB 等其他格式。

## 3. 数据文件结构要求

### 必需的维度 (Dimensions)

| 维度名 | 说明 |
|--------|------|
| `lon` | 经度维度 |
| `lat` | 纬度维度 |
| `lev` | 高度层维度 |

### 必需的变量 (Variables)

| 变量名 | 维度 | 属性 | 说明 |
|--------|------|------|------|
| `lon` | (lon) | - | 经度坐标值 |
| `lat` | (lat) | - | 纬度坐标值 |
| `lev` | (lev) | - | 高度层坐标值 |
| `U` | (lev, lat, lon) | @min, @max | 东西向风速分量 |
| `V` | (lev, lat, lon) | @min, @max | 南北向风速分量 |

### 数据结构示意

```
demo.nc
├── dimensions
│   ├── lon: 360
│   ├── lat: 181
│   └── lev: 3
├── variables
│   ├── lon(lon)         # 经度数组 [0, 1, 2, ..., 359]
│   ├── lat(lat)         # 纬度数组 [-90, -89, ..., 90]
│   ├── lev(lev)         # 高度层数组
│   ├── U(lev, lat, lon) # U风速分量
│   │   ├── @min: -xx.xx
│   │   └── @max: xx.xx
│   └── V(lev, lat, lon) # V风速分量
│       ├── @min: -xx.xx
│       └── @max: xx.xx
```

## 4. 数据约束

### 经度范围

- **要求**：`[0, 360]`
- **不是**：`[-180, 180]`

### 维度顺序

U 和 V 变量的维度顺序必须为：`(lev, lat, lon)`

### 数据读取顺序

netcdfjs 按**行优先**（row-major）方式读取数据：
- `array[0]` 对应 `(lon=0, lat=-90, lev=0)`

## 5. 数据读取流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据读取流程                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  app.js: new Wind3D(panel, mode)                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  wind3D.js: DataProcess.loadData()                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  dataProcess.js:                                               │
│  1. 从 gui.js 获取文件路径: "../data/demo.nc"                    │
│  2. 使用 XMLHttpRequest 以 arraybuffer 方式请求文件              │
│  3. 使用 netcdfjs 库解析二进制数据                               │
│  4. 提取维度信息 (lon, lat, lev)                                │
│  5. 提取变量数据 (U, V) 及其 min/max 属性                        │
│  6. 转换为 Float32Array 返回                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  wind3D.js: new ParticleSystem(context, data, ...)             │
│  使用数据创建粒子系统进行风场可视化                               │
└─────────────────────────────────────────────────────────────────┘
```

## 6. 核心代码解析

### 数据路径配置 (gui.js)

```javascript
const fileOptions = {
    dataDirectory: demo ? 'https://raw.githubusercontent.com/RaymanNg/3D-Wind-Field/master/data/' : '../data/',
    dataFile: "demo.nc",
    glslDirectory: demo ? '../Cesium-3D-Wind/glsl/' : 'glsl/'
}
```

### 数据读取函数 (dataProcess.js)

```javascript
var loadNetCDF = function (filePath) {
    return new Promise(function (resolve) {
        var request = new XMLHttpRequest();
        request.open('GET', filePath);
        request.responseType = 'arraybuffer';

        request.onload = function () {
            var NetCDF = new netcdfjs(request.response);
            data = {};

            // 读取维度
            var dimensions = arrayToMap(NetCDF.dimensions);
            data.dimensions = {};
            data.dimensions.lon = dimensions['lon'].size;
            data.dimensions.lat = dimensions['lat'].size;
            data.dimensions.lev = dimensions['lev'].size;

            // 读取坐标变量
            data.lon = {};
            data.lon.array = new Float32Array(NetCDF.getDataVariable('lon').flat());
            data.lon.min = Math.min(...data.lon.array);
            data.lon.max = Math.max(...data.lon.array);

            data.lat = {};
            data.lat.array = new Float32Array(NetCDF.getDataVariable('lat').flat());
            // ... 类似处理 lat 和 lev

            // 读取风速变量及属性
            var variables = arrayToMap(NetCDF.variables);
            var uAttributes = arrayToMap(variables['U'].attributes);
            var vAttributes = arrayToMap(variables['V'].attributes);

            data.U = {};
            data.U.array = new Float32Array(NetCDF.getDataVariable('U').flat());
            data.U.min = uAttributes['min'].value;
            data.U.max = uAttributes['max'].value;

            data.V = {};
            data.V.array = new Float32Array(NetCDF.getDataVariable('V').flat());
            data.V.min = vAttributes['min'].value;
            data.V.max = vAttributes['max'].value;

            resolve(data);
        };

        request.send();
    });
}
```

### 返回的数据结构

```javascript
data = {
    dimensions: {
        lon: Number,  // 经度维度大小
        lat: Number,  // 纬度维度大小  
        lev: Number   // 高度层维度大小
    },
    lon: { array: Float32Array, min: Number, max: Number },
    lat: { array: Float32Array, min: Number, max: Number },
    lev: { array: Float32Array, min: Number, max: Number },
    U: { array: Float32Array, min: Number, max: Number },  // 东西向风速
    V: { array: Float32Array, min: Number, max: Number }   // 南北向风速
}
```

## 7. 为什么使用 NetCDF 而非 GRIB2？

### 原始数据格式

NASA/NOAA 提供的气象数据（如 GFS 全球预报系统）的**原始格式通常是 GRIB2**。

### 转换原因

| 原因 | 说明 |
|------|------|
| **浏览器兼容性** | JavaScript 有 `netcdfjs` 库可以直接解析 NetCDF V3 |
| **GRIB2 无 JS 库** | 浏览器端没有成熟的 GRIB2 解析库 |
| **格式复杂度** | GRIB2 使用复杂压缩（JPEG2000等），JS 实现困难 |
| **依赖问题** | GRIB2 解析需要 `ecCodes` C 库，无法在浏览器运行 |

### 数据格式对比

| 特性 | NetCDF V3 | GRIB2 |
|------|-----------|-------|
| 浏览器 JS 库 | ✅ netcdfjs | ❌ 无 |
| 自描述性 | ✅ 高 | ⚠️ 复杂 |
| 文件大小 | 较大 | 较小（压缩） |
| 解析难度 | 低 | 高 |

## 8. 如何准备自己的数据

### 步骤 1：获取原始数据

从 NOAA GFS 下载 GRIB2 格式数据：
- 数据源：https://www.ncdc.noaa.gov/data-access/model-data/model-datasets/global-forcast-system-gfs

### 步骤 2：转换格式

使用 **ToolsUI**（Unidata 官方工具）将 GRIB2 转换为 NetCDF V3：
- 下载地址：https://www.unidata.ucar.edu/software/netcdf-java/

### 步骤 3：处理数据

使用 **NCO**（NetCDF Operators）提取和处理数据：
- 官网：http://nco.sourceforge.net/

项目提供的 PowerShell 脚本位于 `Util/processNetCDF.ps1`

### 步骤 4：添加属性

确保 U 和 V 变量包含 `min` 和 `max` 属性：

```bash
# 使用 NCO 添加属性示例
ncatted -a min,U,o,f,-50.0 -a max,U,o,f,50.0 input.nc output.nc
```

### 步骤 5：更新配置

修改 `gui.js` 中的 `dataFile` 指向新文件：

```javascript
const fileOptions = {
    dataDirectory: '../data/',
    dataFile: "your_data.nc",  // 修改为你的文件名
    // ...
}
```

## 9. 使用 JSON 替代 NetCDF

如果想使用 JSON 格式，可以在 `dataProcess.js` 中添加 JSON 加载函数：

```javascript
var loadJSON = function (filePath) {
    return new Promise(function (resolve) {
        fetch(filePath)
            .then(response => response.json())
            .then(jsonData => {
                // 确保返回的数据结构与 loadNetCDF 相同
                data = {
                    dimensions: jsonData.dimensions,
                    lon: jsonData.lon,
                    lat: jsonData.lat,
                    lev: jsonData.lev,
                    U: jsonData.U,
                    V: jsonData.V
                };
                resolve(data);
            });
    });
}
```

## 10. 常用工具

| 工具 | 用途 | 下载地址 |
|------|------|----------|
| **Panoply** | 查看 NetCDF 文件 | https://www.giss.nasa.gov/tools/panoply/ |
| **ToolsUI** | 格式转换 | https://www.unidata.ucar.edu/software/netcdf-java/ |
| **NCO** | 命令行处理 | http://nco.sourceforge.net/ |
| **ncdump** | 查看结构 | NetCDF 库自带 |
| **CDO** | 气候数据处理 | https://code.mpimet.mpg.de/projects/cdo |

### 查看 NetCDF 文件结构

```bash
# 使用 ncdump 查看头信息
ncdump -h demo.nc

# 使用 ncdump 查看完整内容（小文件）
ncdump demo.nc
```

## 11. 注意事项

1. **文件大小限制**：建议使用小于 100MB 的文件，否则浏览器可能崩溃
2. **格式版本**：必须是 NetCDF V3（Classic），不支持 V4
3. **维度顺序**：U/V 变量维度必须是 `(lev, lat, lon)`
4. **属性必需**：U/V 变量必须包含 `min` 和 `max` 属性
5. **经度范围**：使用 `[0, 360]` 而非 `[-180, 180]`

## 12. 相关资源

- **NetCDF 官网**：https://www.unidata.ucar.edu/software/netcdf/
- **netcdfjs 库**：https://github.com/cheminfo-js/netcdfjs
- **NOAA GFS 数据**：https://www.ncdc.noaa.gov/data-access/model-data/model-datasets/global-forcast-system-gfs
- **NetCDF 维基百科**：https://zh.wikipedia.org/wiki/NetCDF

---

*最后更新：2026年2月*
