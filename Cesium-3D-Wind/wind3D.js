class Wind3D {
    constructor(panel, mode) {
        var options = {
            // use Sentinel-2 instead of the default Bing Maps because Bing Maps sessions is limited
            imageryProvider: new Cesium.IonImageryProvider({ assetId: 3954 }),
            baseLayerPicker: true,
            geocoder: false,
            infoBox: false,
            fullscreenElement: 'cesiumContainer',
            // useBrowserRecommendedResolution can be set to false to improve the render quality
            // useBrowserRecommendedResolution: false,
            scene3DOnly: true
        }

        if (mode.debug) {
            options.useDefaultRenderLoop = false;
            console.log('[Wind3D] Debug模式: 使用手动渲染循环');
        } else {
            console.log('[Wind3D] 正常模式: 使用默认渲染循环');
        }

        try {
            console.log('[Wind3D] 正在创建 Cesium Viewer...');
            console.log('[Wind3D] 容器ID: cesiumContainer');
            console.log('[Wind3D] 选项:', JSON.stringify(options, null, 2));
            
            this.viewer = new Cesium.Viewer('cesiumContainer', options);
            console.log('[Wind3D] Viewer 创建成功');
            console.log('[Wind3D] Viewer 对象:', this.viewer);
            console.log('[Wind3D] Scene 对象:', this.viewer.scene);
            console.log('[Wind3D] Camera 对象:', this.viewer.camera);
            
            this.scene = this.viewer.scene;
            this.camera = this.viewer.camera;
            
            // 通知Panel初始化GUI（延迟一点确保widget已完全创建）
            const that = this;
            setTimeout(function() {
                if (that.panel && typeof that.panel.initGUI === 'function') {
                    that.panel.initGUI();
                }
            }, 200);

            // 设置时钟为当前时刻
            var now = Cesium.JulianDate.now();
            this.viewer.clock.currentTime = now;
            this.viewer.clock.startTime = now;
            this.viewer.clock.stopTime = Cesium.JulianDate.addHours(now, 24, new Cesium.JulianDate());
            this.viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
            this.viewer.clock.multiplier = 1.0;
            
            console.log('[Wind3D] 时钟设置完成');
            
            // 强制渲染一次，确保Viewer显示
            setTimeout(function() {
                if (this.viewer && !this.viewer.isDestroyed()) {
                    this.viewer.resize();
                    console.log('[Wind3D] 强制调整Viewer尺寸');
                }
            }.bind(this), 100);
            
        } catch (error) {
            console.error('[Wind3D] Viewer 创建失败:', error);
            console.error('[Wind3D] 错误堆栈:', error.stack);
            throw error;
        }

        this.panel = panel;
        this.particleSystem = null;
        this.mouseHandler = null;  // 用于存储鼠标事件处理器

        this.viewerParameters = {
            lonRange: new Cesium.Cartesian2(),
            latRange: new Cesium.Cartesian2(),
            pixelSize: 0.0
        };
        // use a smaller earth radius to make sure distance to camera > 0
        this.globeBoundingSphere = new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, 0.99 * 6378137.0);
        this.updateViewerParameters();

        // 先设置事件监听器，确保Viewer可以正常使用（即使数据加载失败）
        this.setupEventListeners();
        console.log('[Wind3D] 事件监听器设置完成');

        // 设置图层（必须在数据加载之前，确保地球能显示）
        this.imageryLayers = this.viewer.imageryLayers;
        console.log('[Wind3D] 开始设置图层...');
        this.setGlobeLayer(this.panel.getUserInput());
        console.log('[Wind3D] 图层设置完成, 图层数量:', this.viewer.imageryLayers.length);
        
        // 确保地球可见
        this.viewer.scene.globe.show = true;
        console.log('[Wind3D] 地球显示已启用');
        
        // 设置相机位置，确保能看到地球
        this.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(0, 0, 20000000)
        });
        console.log('[Wind3D] 相机位置已设置');

        // 如果启用debug模式，启动手动渲染循环
        if (mode.debug) {
            console.log('[Wind3D] 启动debug渲染循环');
            this.debug();
        }

        // 初始加载：先加载默认文件，然后尝试从WebAPI获取最新数据
        this.loadInitialData();
    }

    loadInitialData() {
        const that = this;
        
        // 先加载默认文件
        DataProcess.loadData(false).then(
            (data) => {
                if (!data) {
                    console.error('No data loaded');
                    return;
                }
                
                try {
                    that.particleSystem = new ParticleSystem(that.scene.context, data,
                        that.panel.getUserInput(), that.viewerParameters);
                    that.addPrimitives();

                    if (that.panel) {
                        that.panel.dataDate = data.dateString || "20260226_00Z";
                    }

                    // 然后尝试从WebAPI获取最新数据
                    that.updateDataFromWebAPI();
                } catch (error) {
                    console.error('Failed to create particle system:', error);
                }
            }).catch(function(error) {
                console.error('Failed to load initial data:', error);
                // 数据加载失败不影响Viewer显示，只记录错误
            });
    }

    updateDataFromWebAPI() {
        const that = this;
        var currentTime = Cesium.JulianDate.toDate(this.viewer.clock.currentTime);
        
        DataProcess.loadData(true, currentTime).then(
            (data) => {
                if (that.particleSystem) {
                    // 更新数据日期显示
                    if (that.panel && data.dateString) {
                        that.panel.dataDate = data.dateString;
                    }
                    
                    // 更新粒子系统的风场数据
                    that.updateParticleSystemData(data);
                }
            }).catch(function(error) {
                console.warn('Failed to update data from WebAPI:', error);
            });
    }

    updateParticleSystemData(newData) {
        if (!this.particleSystem || !newData) {
            return;
        }

        const that = this;
        
        // 检查维度是否变化
        var dimensionsChanged = false;
        if (this.particleSystem.data) {
            var oldDims = this.particleSystem.data.dimensions;
            var newDims = newData.dimensions;
            if (oldDims.lon !== newDims.lon || oldDims.lat !== newDims.lat || oldDims.lev !== newDims.lev) {
                dimensionsChanged = true;
            }
        }

        // 更新数据
        this.particleSystem.data = newData;
        
        // 销毁旧的风场纹理
        if (this.particleSystem.particlesComputing.windTextures) {
            Object.keys(this.particleSystem.particlesComputing.windTextures).forEach((key) => {
                if (this.particleSystem.particlesComputing.windTextures[key]) {
                    this.particleSystem.particlesComputing.windTextures[key].destroy();
                }
            });
        }
        
        // 重新创建风场纹理
        this.particleSystem.particlesComputing.createWindTextures(this.scene.context, newData);
        
        // 如果维度变化，需要重新创建计算primitives
        if (dimensionsChanged) {
            // 移除旧的primitives
            var primitives = this.particleSystem.particlesComputing.primitives;
            if (primitives.calculateSpeed) {
                this.scene.primitives.remove(primitives.calculateSpeed);
            }
            if (primitives.updatePosition) {
                this.scene.primitives.remove(primitives.updatePosition);
            }
            if (primitives.postProcessingPosition) {
                this.scene.primitives.remove(primitives.postProcessingPosition);
            }
            
            // 重新创建计算primitives
            this.particleSystem.particlesComputing.createComputingPrimitives(
                newData,
                this.panel.getUserInput(),
                this.viewerParameters
            );
            
            // 重新添加primitives
            this.addPrimitives();
        } else {
            // 只更新uniformMap中的维度相关值
            var primitives = this.particleSystem.particlesComputing.primitives;
            if (primitives.calculateSpeed) {
                var dimension = new Cesium.Cartesian3(newData.dimensions.lon, newData.dimensions.lat, newData.dimensions.lev);
                var minimum = new Cesium.Cartesian3(newData.lon.min, newData.lat.min, newData.lev.min);
                var maximum = new Cesium.Cartesian3(newData.lon.max, newData.lat.max, newData.lev.max);
                var interval = new Cesium.Cartesian3(
                    (maximum.x - minimum.x) / (dimension.x - 1),
                    (maximum.y - minimum.y) / (dimension.y - 1),
                    dimension.z > 1 ? (maximum.z - minimum.z) / (dimension.z - 1) : 1.0
                );
                var uSpeedRange = new Cesium.Cartesian2(newData.U.min, newData.U.max);
                var vSpeedRange = new Cesium.Cartesian2(newData.V.min, newData.V.max);
                
                primitives.calculateSpeed.uniformMap.dimension = function() { return dimension; };
                primitives.calculateSpeed.uniformMap.minimum = function() { return minimum; };
                primitives.calculateSpeed.uniformMap.maximum = function() { return maximum; };
                primitives.calculateSpeed.uniformMap.interval = function() { return interval; };
                primitives.calculateSpeed.uniformMap.uSpeedRange = function() { return uSpeedRange; };
                primitives.calculateSpeed.uniformMap.vSpeedRange = function() { return vSpeedRange; };
            }
        }
        
        // 刷新粒子
        this.particleSystem.refreshParticles(false);
    }

    addPrimitives() {
        if (!this.particleSystem) {
            return;
        }
        
        // the order of primitives.add() should respect the dependency of primitives
        this.scene.primitives.add(this.particleSystem.particlesComputing.primitives.calculateSpeed);
        this.scene.primitives.add(this.particleSystem.particlesComputing.primitives.updatePosition);
        this.scene.primitives.add(this.particleSystem.particlesComputing.primitives.postProcessingPosition);

        this.scene.primitives.add(this.particleSystem.particlesRendering.primitives.segments);
        this.scene.primitives.add(this.particleSystem.particlesRendering.primitives.trails);
        this.scene.primitives.add(this.particleSystem.particlesRendering.primitives.screen);
    }

    updateViewerParameters() {
        var viewRectangle = this.camera.computeViewRectangle(this.scene.globe.ellipsoid);
        var lonLatRange = Util.viewRectangleToLonLatRange(viewRectangle);
        this.viewerParameters.lonRange.x = lonLatRange.lon.min;
        this.viewerParameters.lonRange.y = lonLatRange.lon.max;
        this.viewerParameters.latRange.x = lonLatRange.lat.min;
        this.viewerParameters.latRange.y = lonLatRange.lat.max;

        var pixelSize = this.camera.getPixelSize(
            this.globeBoundingSphere,
            this.scene.drawingBufferWidth,
            this.scene.drawingBufferHeight
        );

        if (pixelSize > 0) {
            this.viewerParameters.pixelSize = pixelSize;
        }
    }

    setGlobeLayer(userInput) {
        try {
            console.log('[Wind3D] 设置图层, 类型:', userInput.globeLayer.type);
            this.viewer.imageryLayers.removeAll();
            this.viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();

            var globeLayer = userInput.globeLayer;
            switch (globeLayer.type) {
                case "NaturalEarthII": {
                    console.log('[Wind3D] 使用 NaturalEarthII 图层');
                    this.viewer.imageryLayers.add(
                        Cesium.ImageryLayer.fromProviderAsync(
                            Cesium.TileMapServiceImageryProvider.fromUrl(
                                Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
                            )
                        )
                    );
                    break;
                }
                case "WMS": {
                    console.log('[Wind3D] 使用 WMS 图层, URL:', userInput.WMS_URL);
                    this.viewer.imageryLayers.addImageryProvider(new Cesium.WebMapServiceImageryProvider({
                        url: userInput.WMS_URL,
                        layers: globeLayer.layer,
                        parameters: {
                            ColorScaleRange: globeLayer.ColorScaleRange
                        }
                    }));
                    break;
                }
                case "WorldTerrain": {
                    console.log('[Wind3D] 使用 WorldTerrain 图层');
                    this.viewer.imageryLayers.add(
                        Cesium.ImageryLayer.fromProviderAsync(Cesium.IonImageryProvider.fromAssetId(3954))
                    );
                    this.viewer.scene.setTerrain(Cesium.Terrain.fromWorldTerrain());
                    break;
                }
            }
            console.log('[Wind3D] 图层设置完成, 图层数量:', this.viewer.imageryLayers.length);
        } catch (error) {
            console.error('[Wind3D] 图层设置失败:', error);
            // 即使图层设置失败，也尝试添加默认图层
            try {
                this.viewer.imageryLayers.add(
                    Cesium.ImageryLayer.fromProviderAsync(
                        Cesium.TileMapServiceImageryProvider.fromUrl(
                            Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
                        )
                    )
                );
                console.log('[Wind3D] 已添加默认图层');
            } catch (e) {
                console.error('[Wind3D] 添加默认图层也失败:', e);
            }
        }
    }

    setupEventListeners() {
        const that = this;

        this.camera.moveStart.addEventListener(function () {
            if (that.scene && that.scene.primitives) {
                that.scene.primitives.show = false;
            }
        });

        this.camera.moveEnd.addEventListener(function () {
            that.updateViewerParameters();
            if (that.particleSystem) {
                that.particleSystem.applyViewerParameters(that.viewerParameters);
            }
            if (that.scene && that.scene.primitives) {
                that.scene.primitives.show = true;
            }
        });

        var resized = false;
        window.addEventListener("resize", function () {
            resized = true;
            if (that.scene && that.scene.primitives) {
                that.scene.primitives.show = false;
                that.scene.primitives.removeAll();
            }
        });

        this.scene.preRender.addEventListener(function () {
            if (resized && that.particleSystem) {
                that.particleSystem.canvasResize(that.scene.context);
                resized = false;
                that.addPrimitives();
                if (that.scene && that.scene.primitives) {
                    that.scene.primitives.show = true;
                }
            }
        });

        window.addEventListener('particleSystemOptionsChanged', function () {
            if (that.particleSystem) {
                that.particleSystem.applyUserInput(that.panel.getUserInput());
            }
        });
        window.addEventListener('layerOptionsChanged', function () {
            that.setGlobeLayer(that.panel.getUserInput());
        });
        
        // 添加鼠标移动事件监听，用于显示风速
        this.setupMouseMoveListener();
    }
    
    setupMouseMoveListener() {
        const that = this;
        // 如果已存在handler，先销毁
        if (this.mouseHandler) {
            this.mouseHandler.destroy();
        }
        
        this.mouseHandler = new Cesium.ScreenSpaceEventHandler(this.scene.canvas);
        
        this.mouseHandler.setInputAction(function(movement) {
            if (!that.panel || !that.panel.showWindSpeed) {
                return;
            }
            
            // 获取鼠标位置的经纬度
            var cartesian = that.camera.pickEllipsoid(movement.endPosition, that.scene.globe.ellipsoid);
            if (!cartesian) {
                // 如果鼠标不在球面上，尝试从相机射线获取
                var ray = that.camera.getPickRay(movement.endPosition);
                if (ray) {
                    var intersection = Cesium.IntersectionTests.rayEllipsoid(ray, that.scene.globe.ellipsoid);
                    if (intersection) {
                        cartesian = Cesium.Ray.getPoint(ray, intersection.start);
                    }
                }
            }
            
            if (cartesian) {
                var cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                var longitude = Cesium.Math.toDegrees(cartographic.longitude);
                var latitude = Cesium.Math.toDegrees(cartographic.latitude);
                
                // 更新面板显示的经纬度（使用字符串格式，确保显示小数位）
                that.panel.mouseLongitude = longitude.toFixed(3);
                that.panel.mouseLatitude = latitude.toFixed(3);
                
                // 获取风速数据
                if (that.particleSystem && that.particleSystem.data) {
                    var windData = that.getWindSpeedAtPosition(longitude, latitude);
                    that.panel.windU = windData.u.toFixed(1);
                    that.panel.windV = windData.v.toFixed(1);
                } else {
                    that.panel.windU = "0.0";
                    that.panel.windV = "0.0";
                }
            }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        
        // 监听显示风速开关的变化
        window.addEventListener('showWindSpeedChanged', function(event) {
            // 当关闭时，清空显示
            if (!event.detail.enabled) {
                that.panel.mouseLongitude = "0.000";
                that.panel.mouseLatitude = "0.000";
                that.panel.windU = "0.0";
                that.panel.windV = "0.0";
            }
        });
    }
    
    // 清理资源
    destroy() {
        if (this.mouseHandler) {
            this.mouseHandler.destroy();
            this.mouseHandler = null;
        }
        if (this.viewer && !this.viewer.isDestroyed()) {
            this.viewer.destroy();
        }
    }
    
    // 根据经纬度从数据中插值获取U和V风速分量
    getWindSpeedAtPosition(longitude, latitude) {
        if (!this.particleSystem || !this.particleSystem.data) {
            return { u: 0.0, v: 0.0 };
        }
        
        var data = this.particleSystem.data;
        var uArray = data.U.array;
        var vArray = data.V.array;
        var lonDim = data.dimensions.lon;
        var latDim = data.dimensions.lat;
        var levDim = data.dimensions.lev;
        
        // 使用第一个高度层（lev=0）的数据
        var levIndex = 0;
        
        // 确保经度在有效范围内（NetCDF数据使用0-360范围）
        var normalizedLon = ((longitude % 360) + 360) % 360;
        if (normalizedLon > 180) {
            normalizedLon = normalizedLon - 360;
        }
        
        // 确保纬度在有效范围内
        latitude = Math.max(-90, Math.min(90, latitude));
        
        // 检查是否在数据范围内
        // 注意：如果数据经度范围是0-360，需要转换
        var lonMin = data.lon.min;
        var lonMax = data.lon.max;
        var lonRange = lonMax - lonMin;
        
        // 如果数据范围是0-360，需要将longitude转换到该范围
        if (lonMax > 180) {
            normalizedLon = ((longitude % 360) + 360) % 360;
        }
        
        if (normalizedLon < lonMin || normalizedLon > lonMax ||
            latitude < data.lat.min || latitude > data.lat.max) {
            return { u: 0.0, v: 0.0 };
        }
        
        // 找到最近的网格点索引（简化版本，使用最近邻插值）
        var lonIndex = Math.round((normalizedLon - lonMin) / (lonRange / (lonDim - 1)));
        var latIndex = Math.round((latitude - data.lat.min) / ((data.lat.max - data.lat.min) / (latDim - 1)));
        
        lonIndex = Math.max(0, Math.min(lonDim - 1, lonIndex));
        latIndex = Math.max(0, Math.min(latDim - 1, latIndex));
        
        // 计算在3D数组中的索引
        // 数据维度顺序是 (lev, lat, lon)，netcdfjs按行优先读取
        // 索引公式: index = levIndex * (latDim * lonDim) + latIndex * lonDim + lonIndex
        var index = levIndex * (latDim * lonDim) + latIndex * lonDim + lonIndex;
        
        if (index >= 0 && index < uArray.length && index < vArray.length) {
            return {
                u: uArray[index],
                v: vArray[index]
            };
        }
        
        return { u: 0.0, v: 0.0 };
    }

    debug() {
        const that = this;

        var animate = function () {
            that.viewer.resize();
            that.viewer.render();
            requestAnimationFrame(animate);
        }

        var spector = new SPECTOR.Spector();
        spector.displayUI();
        spector.spyCanvases();

        animate();
    }
}
