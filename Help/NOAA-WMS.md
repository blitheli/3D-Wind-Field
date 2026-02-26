# NOAA THREDDS WMS 服务详解

## 1. 概述

本项目使用 **NOAA NCEI THREDDS 服务器** 提供的 WMS（Web Map Service）服务来叠加气象图层背景。

WMS 服务端点示例：
```
https://www.ncei.noaa.gov/thredds/wms/model-gfs-g4-anl-files-old/201809/20180916/gfsanl_4_20180916_0000_000.grb2
```

## 2. THREDDS Data Server (TDS) 架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                    NOAA THREDDS 数据服务器架构                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌─────────────┐                                                      │
│   │ GRIB2/NetCDF│    THREDDS Data Server                              │
│   │   原始数据   │ ──→  (Java Web应用)                                  │
│   └─────────────┘           │                                          │
│                             ├──→ WMS (网络地图服务) ──→ 返回图片         │
│                             ├──→ WCS (网络覆盖服务) ──→ 返回数据子集     │
│                             ├──→ OPeNDAP         ──→ 远程数据访问       │
│                             └──→ HTTP Download   ──→ 文件下载          │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

THREDDS（Thematic Real-time Environmental Distributed Data Services）是由 Unidata 开发的数据服务器，可以将 GRIB2/NetCDF 等科学数据格式通过多种协议发布为 Web 服务。

## 3. WMS vs WMTS 区别

| 特性 | WMS | WMTS |
|------|-----|------|
| **全称** | Web Map Service | Web Map Tile Service |
| **响应方式** | 动态渲染图片 | 预切割瓦片 |
| **请求灵活性** | 高（任意范围/大小） | 低（固定瓦片级别） |
| **服务器压力** | 较高 | 较低 |
| **实时数据** | ✅ 支持 | ❌ 需要预处理 |
| **NOAA 使用** | ✅ THREDDS 提供 | 较少使用 |

**NOAA 主要使用 WMS**，因为气象数据需要实时更新，不适合预切瓦片。

## 4. WMS 请求格式

### URL 结构

```
https://www.ncei.noaa.gov/thredds/wms/[数据路径]/[文件名].grb2
```

### GetMap 请求参数示例

```
?SERVICE=WMS
&VERSION=1.3.0
&REQUEST=GetMap
&LAYERS=Pressure_surface          # 图层名称
&STYLES=default                   # 渲染样式
&CRS=EPSG:4326                   # 坐标系
&BBOX=-180,-90,180,90            # 边界框
&WIDTH=800                       # 图片宽度
&HEIGHT=400                      # 图片高度
&FORMAT=image/png                # 输出格式
&COLORSCALERANGE=51640,103500    # 色标范围（自定义）
```

### GetCapabilities 请求

获取服务支持的所有图层信息：

```
https://www.ncei.noaa.gov/thredds/wms/[数据路径]/[文件名].grb2?SERVICE=WMS&REQUEST=GetCapabilities
```

## 5. 可用图层（基于 GFS 数据）

| 图层名称 | 说明 | 单位 |
|----------|------|------|
| `Pressure_surface` | 地表气压 | Pa |
| `Wind_speed_gust_surface` | 阵风风速 | m/s |
| `Temperature_surface` | 地表温度 | K |
| `Relative_humidity_*` | 相对湿度 | % |
| `Total_precipitation_*` | 降水量 | kg/m² |
| `u-component_of_wind_*` | U风分量 | m/s |
| `v-component_of_wind_*` | V风分量 | m/s |

> **注意**：具体图层名称取决于 GRIB2 文件内容，可通过 GetCapabilities 请求获取完整列表。

## 6. 在 Cesium 中使用

### 项目配置 (gui.js)

```javascript
const globeLayers = [
    { name: "NaturalEarthII", type: "NaturalEarthII" },
    { name: "WMS:Air Pressure", type: "WMS", layer: "Pressure_surface", ColorScaleRange: '51640,103500' },
    { name: "WMS:Wind Speed", type: "WMS", layer: "Wind_speed_gust_surface", ColorScaleRange: '0.1095,35.31' },
    { name: "WorldTerrain", type: "WorldTerrain" }
]

const defaultLayerOptions = {
    "globeLayer": globeLayers[0],
    "WMS_URL": "https://www.ncei.noaa.gov/thredds/wms/model-gfs-g4-anl-files-old/201809/20180916/gfsanl_4_20180916_0000_000.grb2",
}
```

### 添加 WMS 图层 (wind3D.js)

```javascript
this.viewer.imageryLayers.addImageryProvider(
    new Cesium.WebMapServiceImageryProvider({
        url: userInput.WMS_URL,              // THREDDS WMS 端点
        layers: globeLayer.layer,             // 如 "Pressure_surface"
        parameters: {
            ColorScaleRange: globeLayer.ColorScaleRange  // 色标范围
        }
    })
);
```

## 7. 如何获取最新的 WMS URL

1. 访问 NOAA THREDDS 目录：https://www.ncei.noaa.gov/thredds/catalog.html
2. 导航到 **Model Data** → **GFS** (Global Forecast System)
3. 选择所需日期的数据文件（如 `gfsanl_4_20180916_0000_000.grb2`）
4. 点击文件旁边的 **WMS** 链接获取服务地址

## 8. WMS 服务优缺点

### 优点

| 优点 | 说明 |
|------|------|
| ✅ 无需下载大文件 | 服务器端渲染，客户端只接收图片 |
| ✅ 实时更新 | 直接访问最新预报数据 |
| ✅ 直接在地图上叠加 | Cesium/Leaflet 等框架原生支持 |
| ✅ 色标可自定义 | 通过 ColorScaleRange 参数调整 |

### 缺点

| 缺点 | 说明 |
|------|------|
| ❌ 只能获取图片 | 无法获取原始数值数据 |
| ❌ 无法做粒子动画 | 粒子系统需要 U/V 风速数据 |
| ❌ 依赖网络连接 | 离线环境无法使用 |
| ❌ 服务可能变更 | URL 路径可能更新或失效 |

## 9. 项目中的数据使用策略

```
┌─────────────────────────────────────────────────────────────────┐
│                      项目数据使用策略                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   NetCDF (demo.nc)                    WMS 服务                  │
│   ├── 用于：粒子风场动画              ├── 用于：背景图层叠加      │
│   ├── 需要：原始 U/V 数值             ├── 返回：渲染好的图片      │
│   └── 特点：本地处理，GPU 渲染         └── 特点：即插即用        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- **粒子动画需要原始数值数据** → 必须用 NetCDF
- **背景气压/温度图层** → 可以用 WMS 服务直接叠加

## 10. 故障排除

### WMS 图层无法显示

如果 WMS 图层加载失败，可能是 URL 已变更。解决方法：

1. 访问 NOAA THREDDS 目录获取最新 URL
2. 更新 `gui.js` 中的 `WMS_URL` 变量
3. 检查浏览器控制台是否有 CORS 错误

### 常见错误

| 错误 | 可能原因 | 解决方案 |
|------|----------|----------|
| 404 Not Found | URL 过期 | 获取最新 URL |
| CORS 错误 | 跨域限制 | 使用代理服务器 |
| 图层为空 | 图层名称错误 | 检查 GetCapabilities |
| 超时 | 网络问题 | 检查网络连接 |

## 11. 相关资源

- **NOAA THREDDS 目录**：https://www.ncei.noaa.gov/thredds/catalog.html
- **GFS 数据说明**：https://www.ncdc.noaa.gov/data-access/model-data/model-datasets/global-forcast-system-gfs
- **OGC WMS 规范**：https://www.ogc.org/standards/wms
- **Cesium WMS 文档**：https://cesium.com/learn/cesiumjs/ref-doc/WebMapServiceImageryProvider.html

## 12. 其他 NOAA 数据服务

除了 WMS，NOAA 还提供以下数据访问方式：

| 服务 | 说明 | 用途 |
|------|------|------|
| **OPeNDAP** | 远程数据访问协议 | 获取数据子集 |
| **WCS** | 网络覆盖服务 | 获取栅格数据 |
| **HTTP Download** | 直接下载 | 获取完整文件 |
| **NOMADS** | 实时预报数据 | 最新 GFS 预报 |

---

*最后更新：2026年2月*
