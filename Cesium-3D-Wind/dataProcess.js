var DataProcess = (function () {
    var data;

    var parseNetCDFBuffer = function (buffer) {
        var arrayToMap = function (array) {
            return array.reduce(function (map, object) {
                map[object.name] = object;
                return map;
            }, {});
        }

        var NetCDF = new netcdfjs(buffer);
        var parsedData = {};

        var dimensions = arrayToMap(NetCDF.dimensions);
        parsedData.dimensions = {};
        parsedData.dimensions.lon = dimensions['lon'].size;
        parsedData.dimensions.lat = dimensions['lat'].size;
        parsedData.dimensions.lev = dimensions['lev'].size;

        var variables = arrayToMap(NetCDF.variables);
        var uAttributes = arrayToMap(variables['U'].attributes);
        var vAttributes = arrayToMap(variables['V'].attributes);

        parsedData.lon = {};
        parsedData.lon.array = new Float32Array(NetCDF.getDataVariable('lon').flat());
        parsedData.lon.min = Math.min(...parsedData.lon.array);
        parsedData.lon.max = Math.max(...parsedData.lon.array);

        parsedData.lat = {};
        parsedData.lat.array = new Float32Array(NetCDF.getDataVariable('lat').flat());
        parsedData.lat.min = Math.min(...parsedData.lat.array);
        parsedData.lat.max = Math.max(...parsedData.lat.array);

        parsedData.lev = {};
        parsedData.lev.array = new Float32Array(NetCDF.getDataVariable('lev').flat());
        parsedData.lev.min = Math.min(...parsedData.lev.array);
        parsedData.lev.max = Math.max(...parsedData.lev.array);

        parsedData.U = {};
        parsedData.U.array = new Float32Array(NetCDF.getDataVariable('U').flat());
        parsedData.U.min = uAttributes['min'].value;
        parsedData.U.max = uAttributes['max'].value;

        parsedData.V = {};
        parsedData.V.array = new Float32Array(NetCDF.getDataVariable('V').flat());
        parsedData.V.min = vAttributes['min'].value;
        parsedData.V.max = vAttributes['max'].value;

        return parsedData;
    }

    var loadNetCDF = function (filePath) {
        return new Promise(function (resolve, reject) {
            var request = new XMLHttpRequest();
            request.open('GET', filePath);
            request.responseType = 'arraybuffer';

            request.onload = function () {
                try {
                    data = parseNetCDFBuffer(request.response);
                    resolve(data);
                } catch (error) {
                    reject(error);
                }
            };

            request.onerror = function () {
                reject(new Error('Failed to load NetCDF file: ' + filePath));
            };

            request.send();
        });
    }

    // 获取最近的00Z/06Z/12Z/18Z时刻
    var getNearestRunTime = function (currentTime) {
        var date = new Date(currentTime);
        var hour = date.getUTCHours();
        var runHours = [0, 6, 12, 18];
        
        // 找到最近的运行时刻（考虑当天和前一天的运行时刻）
        var nearestRun = 0;
        var minDiff = 24;
        var usePreviousDay = false;
        
        // 先检查当天的运行时刻
        for (var i = 0; i < runHours.length; i++) {
            var diff = Math.abs(hour - runHours[i]);
            if (diff < minDiff) {
                minDiff = diff;
                nearestRun = runHours[i];
                usePreviousDay = false;
            }
        }
        
        // 如果当前时间接近前一天的18Z（例如当前是00:00-02:59），也考虑前一天的18Z
        if (hour < 3) {
            var diffToPrev18Z = hour + (24 - 18); // 距离前一天18Z的小时数
            if (diffToPrev18Z < minDiff) {
                minDiff = diffToPrev18Z;
                nearestRun = 18;
                usePreviousDay = true;
            }
        }
        
        if (usePreviousDay) {
            date.setUTCDate(date.getUTCDate() - 1);
        }
        
        date.setUTCHours(nearestRun, 0, 0, 0);
        return date;
    }

    // 从WebAPI获取nc文件（单个请求）
    var loadDataFromWebAPIOnce = function (targetTime) {
        return new Promise(function (resolve, reject) {
            var runTime = getNearestRunTime(targetTime);
            var timeStr = runTime.toISOString();
            
            var apiUrl = fileOptions.webApiUrl + '?time=' + encodeURIComponent(timeStr) + '&forecast=-1';
            
            console.log('[WebAPI] 请求URL:', apiUrl);
            console.log('[WebAPI] 目标时间:', timeStr);
            console.log('[WebAPI] 运行时刻:', runTime.toISOString());
            
            var request = new XMLHttpRequest();
            request.open('GET', apiUrl);
            request.responseType = 'arraybuffer';

            request.onload = function () {
                if (request.status === 200) {
                    try {
                        var arrayBuffer = request.response;
                        var fileSize = arrayBuffer.byteLength;
                        console.log('[WebAPI] 下载成功! 文件大小:', (fileSize / 1024 / 1024).toFixed(2), 'MB');
                        
                        // 保存原始arrayBuffer到全局变量，方便调试
                        if (typeof window !== 'undefined') {
                            window.lastDownloadedNCFile = {
                                arrayBuffer: arrayBuffer,
                                url: apiUrl,
                                time: timeStr,
                                runTime: runTime,
                                size: fileSize,
                                timestamp: new Date()
                            };
                            console.log('[WebAPI] 文件已保存到 window.lastDownloadedNCFile，可在控制台查看');
                            console.log('[WebAPI] 下载文件:', window.lastDownloadedNCFile);
                            
                            // 提供下载函数
                            window.downloadLastNCFile = function() {
                                var blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
                                var url = URL.createObjectURL(blob);
                                var a = document.createElement('a');
                                var year = runTime.getUTCFullYear();
                                var month = String(runTime.getUTCMonth() + 1).padStart(2, '0');
                                var day = String(runTime.getUTCDate()).padStart(2, '0');
                                var hour = String(runTime.getUTCHours()).padStart(2, '0');
                                var fileName = 'gfs_' + year + month + day + '_' + hour + 'z.nc';
                                a.href = url;
                                a.download = fileName;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                                console.log('[WebAPI] 文件已下载:', fileName);
                            };
                            console.log('[WebAPI] 使用 downloadLastNCFile() 可以下载文件');
                        }
                        
                        var resultData = parseNetCDFBuffer(arrayBuffer);
                        
                        // 格式化日期字符串用于显示：YYYYMMDD_HHZ
                        var year = runTime.getUTCFullYear();
                        var month = String(runTime.getUTCMonth() + 1).padStart(2, '0');
                        var day = String(runTime.getUTCDate()).padStart(2, '0');
                        var hour = String(runTime.getUTCHours()).padStart(2, '0');
                        resultData.dateString = year + month + day + '_' + hour + 'Z';
                        
                        console.log('[WebAPI] 数据解析成功，日期:', resultData.dateString);
                        
                        resolve(resultData);
                    } catch (error) {
                        console.error('[WebAPI] 数据解析失败:', error);
                        reject(error);
                    }
                } else {
                    console.error('[WebAPI] 请求失败，状态码:', request.status);
                    reject(new Error('WebAPI request failed with status: ' + request.status));
                }
            };

            request.onerror = function () {
                console.error('[WebAPI] 网络错误，URL:', apiUrl);
                reject(new Error('Failed to load data from WebAPI: ' + apiUrl));
            };

            request.onprogress = function(event) {
                if (event.lengthComputable) {
                    var percentComplete = (event.loaded / event.total) * 100;
                    console.log('[WebAPI] 下载进度:', percentComplete.toFixed(1) + '%');
                }
            };

            request.send();
        });
    }

    // 从WebAPI获取nc文件（带重试逻辑：失败时向后6小时重试）
    var loadDataFromWebAPI = function (targetTime) {
        return new Promise(function (resolve, reject) {
            // 第一次尝试：使用当前时间
            loadDataFromWebAPIOnce(targetTime).then(function (resultData) {
                data = resultData;
                resolve(data);
            }).catch(function (error) {
                console.warn('First WebAPI attempt failed, trying 6 hours earlier:', error);
                
                // 第二次尝试：向前6小时（减去6小时）
                var retryTime = new Date(targetTime);
                retryTime.setUTCHours(retryTime.getUTCHours() - 6);
                
                loadDataFromWebAPIOnce(retryTime).then(function (resultData) {
                    data = resultData;
                    resolve(data);
                }).catch(function (retryError) {
                    console.warn('Second WebAPI attempt (6 hours earlier) also failed:', retryError);
                    reject(retryError);
                });
            });
        });
    }

    var loadData = async function (useWebAPI, targetTime) {
        if (useWebAPI && fileOptions.webApiUrl) {
            try {
                await loadDataFromWebAPI(targetTime || new Date());
                if (data) {
                    return data;
                }
            } catch (error) {
                console.warn('Failed to load from WebAPI, falling back to local file:', error);
                // 如果WebAPI失败，回退到本地文件
            }
        }
        
        // 默认加载本地文件
        try {
            var ncFilePath = fileOptions.dataDirectory + fileOptions.dataFile;
            await loadNetCDF(ncFilePath);
            
            // 设置默认日期字符串
            if (data && !data.dateString) {
                data.dateString = "20260226_00Z";
            }

            return data;
        } catch (error) {
            console.error('Failed to load local NetCDF file:', error);
            // 返回null而不是抛出异常，让调用者处理
            return null;
        }
    }

    var randomizeParticles = function (maxParticles, viewerParameters) {
        var array = new Float32Array(4 * maxParticles);
        for (var i = 0; i < maxParticles; i++) {
            array[4 * i] = Cesium.Math.randomBetween(viewerParameters.lonRange.x, viewerParameters.lonRange.y);
            array[4 * i + 1] = Cesium.Math.randomBetween(viewerParameters.latRange.x, viewerParameters.latRange.y);
            array[4 * i + 2] = Cesium.Math.randomBetween(data.lev.min, data.lev.max);
            array[4 * i + 3] = 0.0;
        }
        return array;
    }

    return {
        loadData: loadData,
        randomizeParticles: randomizeParticles,
        updateData: loadData  // 用于更新数据
    };

})();