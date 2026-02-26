// 确保 demo 变量已定义
if (typeof demo === 'undefined') {
    var demo = false;
}

const mode = {
    debug: demo ? false : true
};

console.log('[App] 初始化开始, demo =', demo, ', debug =', mode.debug);

try {
    var panel = new Panel();
    console.log('[App] Panel 创建成功');
    
    var wind3D = new Wind3D(panel, mode);
    console.log('[App] Wind3D 初始化完成');
} catch (error) {
    console.error('[App] 初始化失败:', error);
    throw error;
}
