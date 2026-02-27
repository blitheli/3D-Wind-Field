var demo = Cesium.defaultValue(demo, false);

const fileOptions = {
    dataDirectory: demo ? 'https://raw.githubusercontent.com/RaymanNg/3D-Wind-Field/master/data/' : '../data/',
    dataFile: demo ? "demo.nc" : "gfs_20260226_00z.nc",
    currentDataFile: "gfs_20260226_00z.nc",     //  保存当前使用    
    glslDirectory: (typeof glslDirectory !== 'undefined' ? glslDirectory : (demo ? '../Cesium-3D-Wind/glsl/' : 'glsl/')),
    webApiUrl: "http://localhost:5131/api/winddata/nc",
    // 可手动指定WMS URL，如果设置了此值，将优先使用此URL而不是自动生成的
    // 如果为null或空字符串，则使用自动生成的URL
    manualWMSUrl: null  // 例如: "https://www.ncei.noaa.gov/thredds/wms/model-gfs-g4-anl-files-old/201809/20180916/gfsanl_4_20180916_0000_000.grb2"
}

// 从 currentDataFile 生成对应的 WMS_URL
function generateWMSUrlFromDataFile(dataFile) {
    // 解析文件名格式: gfs_YYYYMMDD_HHz.nc
    var match = dataFile.match(/gfs_(\d{8})_(\d{2})z\.nc/);
    if (!match) {
        // 如果格式不匹配，返回已知可用的默认URL（2018年数据）
        return "https://www.ncei.noaa.gov/thredds/wms/model-gfs-g4-anl-files-old/201809/20180916/gfsanl_4_20180916_0000_000.grb2";
    }
    
    var dateStr = match[1];  // YYYYMMDD
    var hourStr = match[2];  // HH
    var year = parseInt(dateStr.substring(0, 4));
    var month = dateStr.substring(4, 6);
    var day = dateStr.substring(6, 8);
    var yearMonth = dateStr.substring(0, 6);  // YYYYMM
    
    // 检查日期是否合理（如果年份太新，可能数据还不存在，使用备用URL）
    // 当前已知可用的数据主要在2018-2020年左右
    // 如果日期是2020年之后，使用已知可用的备用URL
    if (year > 2020) {
        console.warn('[WMS URL] 日期 ' + dateStr + ' 可能没有对应的WMS数据，使用备用URL');
        // 使用已知可用的2018年数据作为备用
        return "https://www.ncei.noaa.gov/thredds/wms/model-gfs-g4-anl-files-old/201809/20180916/gfsanl_4_20180916_0000_000.grb2";
    }
    
    // 生成 WMS URL 格式: .../YYYYMM/YYYYMMDD/gfsanl_4_YYYYMMDD_HH00_000.grb2
    // 注意：NOAA的THREDDS服务可能已经更新，如果此URL不可用，请访问
    // https://www.ncei.noaa.gov/thredds/catalog.html 查找最新的GFS数据路径
    var wmsUrl = "https://www.ncei.noaa.gov/thredds/wms/model-gfs-g4-anl-files-old/" + 
                 yearMonth + "/" + dateStr + "/gfsanl_4_" + dateStr + "_" + hourStr + "00_000.grb2";
    
    return wmsUrl;
}

const defaultParticleSystemOptions = {
    maxParticles: 64 * 64,
    particleHeight: 100.0,
    fadeOpacity: 0.999,  // 尾迹更长（每帧保留 99.9%）
    dropRate: 0.003,
    dropRateBump: 0.01,
    speedFactor: 1.0,
    lineWidth: 4.0
}

const globeLayers = [
    { name: "NaturalEarthII", type: "NaturalEarthII" },
    { name: "WMS:Air Pressure", type: "WMS", layer: "Pressure_surface", ColorScaleRange: '51640,103500' },
    { name: "WMS:Wind Speed", type: "WMS", layer: "Wind_speed_gust_surface", ColorScaleRange: '0.1095,35.31' },
    { name: "WorldTerrain", type: "WorldTerrain" }
]

const defaultLayerOptions = {
    "globeLayer": globeLayers[0],
    "WMS_URL": fileOptions.manualWMSUrl || generateWMSUrlFromDataFile(fileOptions.currentDataFile),
}

class Panel {
    constructor() {
        this.maxParticles = defaultParticleSystemOptions.maxParticles;
        this.particleHeight = defaultParticleSystemOptions.particleHeight;
        this.fadeOpacity = defaultParticleSystemOptions.fadeOpacity;
        this.dropRate = defaultParticleSystemOptions.dropRate;
        this.dropRateBump = defaultParticleSystemOptions.dropRateBump;
        this.speedFactor = defaultParticleSystemOptions.speedFactor;
        this.lineWidth = defaultParticleSystemOptions.lineWidth;

        this.globeLayer = defaultLayerOptions.globeLayer;
        this.WMS_URL = defaultLayerOptions.WMS_URL;
        this.dataDate = "20260226_00Z";  // 数据日期显示
        
        // 显示风速相关属性
        this.showWindSpeed = false;  // checkbox: 显示风速
        
        // 使用字符串格式来显示，避免显示滑块
        this.mouseLongitude = "0.000";    // 鼠标位置的经度（字符串格式）
        this.mouseLatitude = "0.000";      // 鼠标位置的纬度（字符串格式）
        this.windU = "0.0";                // U方向风速 (m/s)（字符串格式）
        this.windV = "0.0";                // V方向风速 (m/s)（字符串格式）

        var layerNames = [];
        globeLayers.forEach(function (layer) {
            layerNames.push(layer.name);
        });
        this.layerToShow = layerNames[0];

        var onParticleSystemOptionsChange = function () {
            var event = new CustomEvent('particleSystemOptionsChanged');
            window.dispatchEvent(event);
        }

        const that = this;
        var onLayerOptionsChange = function () {
            for (var i = 0; i < globeLayers.length; i++) {
                if (that.layerToShow == globeLayers[i].name) {
                    that.globeLayer = globeLayers[i];
                    break;
                }
            }
            var event = new CustomEvent('layerOptionsChanged');
            window.dispatchEvent(event);
        }

        // 保存GUI初始化函数，供外部调用
        this.gui = null;
        this.initGUI = function () {
            // 如果GUI已初始化，直接返回
            if (that.gui) {
                return;
            }
            
            var panelContainer = document.getElementsByClassName('cesium-widget').item(0);
            if (!panelContainer) {
                // 如果widget还没创建，延迟重试
                setTimeout(that.initGUI, 100);
                return;
            }
            
            that.gui = new dat.GUI({ autoPlace: false });
            that.gui.add(that, 'dataDate').name('数据日期').listen();
            that.gui.add(that, 'maxParticles', 1, 256 * 256, 1).onFinishChange(onParticleSystemOptionsChange);
            that.gui.add(that, 'particleHeight', 1, 10000, 1).onFinishChange(onParticleSystemOptionsChange);
            that.gui.add(that, 'fadeOpacity', 0.90, 0.999, 0.001).onFinishChange(onParticleSystemOptionsChange);
            that.gui.add(that, 'dropRate', 0.0, 0.1).onFinishChange(onParticleSystemOptionsChange);
            that.gui.add(that, 'dropRateBump', 0, 0.2).onFinishChange(onParticleSystemOptionsChange);
            that.gui.add(that, 'speedFactor', 0.05, 8).onFinishChange(onParticleSystemOptionsChange);
            that.gui.add(that, 'lineWidth', 0.01, 16.0).onFinishChange(onParticleSystemOptionsChange);

            that.gui.add(that, 'layerToShow', layerNames).onFinishChange(onLayerOptionsChange);
            
            // 添加显示风速的checkbox和相关显示字段
            that.gui.add(that, 'showWindSpeed').name('显示风速').onChange(function(value) {
                var event = new CustomEvent('showWindSpeedChanged', { detail: { enabled: value } });
                window.dispatchEvent(event);
            });
            
            // 添加只读显示字段（使用字符串，不显示滑块）
            var lonController = that.gui.add(that, 'mouseLongitude').name('经度').listen();
            lonController.__li.style.pointerEvents = 'none'; // 禁用交互
            // 隐藏滑块，只显示文本
            var lonSlider = lonController.__li.querySelector('.slider');
            if (lonSlider) lonSlider.style.display = 'none';
            
            var latController = that.gui.add(that, 'mouseLatitude').name('纬度').listen();
            latController.__li.style.pointerEvents = 'none'; // 禁用交互
            var latSlider = latController.__li.querySelector('.slider');
            if (latSlider) latSlider.style.display = 'none';
            
            var uController = that.gui.add(that, 'windU').name('风速 U (m/s)').listen();
            uController.__li.style.pointerEvents = 'none'; // 禁用交互
            var uSlider = uController.__li.querySelector('.slider');
            if (uSlider) uSlider.style.display = 'none';
            
            var vController = that.gui.add(that, 'windV').name('风速 V (m/s)').listen();
            vController.__li.style.pointerEvents = 'none'; // 禁用交互
            var vSlider = vController.__li.querySelector('.slider');
            if (vSlider) vSlider.style.display = 'none';

            that.gui.domElement.classList.add('myPanel');
            panelContainer.appendChild(that.gui.domElement);
            console.log('[Panel] GUI 初始化完成');
        };
        
        // 尝试立即初始化（如果widget已存在）
        setTimeout(function() {
            that.initGUI();
        }, 100);
    }

    getUserInput() {
        // make sure maxParticles is exactly the square of particlesTextureSize
        var particlesTextureSize = Math.ceil(Math.sqrt(this.maxParticles));
        this.maxParticles = particlesTextureSize * particlesTextureSize;

        return {
            particlesTextureSize: particlesTextureSize,
            maxParticles: this.maxParticles,
            particleHeight: this.particleHeight,
            fadeOpacity: this.fadeOpacity,
            dropRate: this.dropRate,
            dropRateBump: this.dropRateBump,
            speedFactor: this.speedFactor,
            lineWidth: this.lineWidth,
            globeLayer: this.globeLayer,
            WMS_URL: this.WMS_URL
        }
    }
}
