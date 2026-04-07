/**
 * 吉利银河青龙脚本
 * 可实现查询信息、打开哨兵、签到、查询积分等功能
 * 支持MQTT服务，可接入HomeAssistant
 * 需要依赖：mqtt
 * 作者微信：greenteacher46 加微信说明来意，不接受免费咨询，可交流技术

 * 使用方法：
 * 1. 在青龙面板中添加环境变量：
 *    - 变量名：jlyh
 *    - 变量值："用1.26.1老版本app，抓短信验证码登录的包
 *    - https://galaxy-user-api.geely.com/api/v1/login/mobileCodeLogin响应体里的：refreshToken、hardwareDeviceId
 *    - 需注意！抓包时候先不要打开抓包，先拿到短信验证码，点击登录的前一刻打开抓包，这样才能抓到，否则会请求错误
 *    - 注意我说的是值 并不是全部 填错的自己看着点
 *    - 变量值格式是：refreshToke的值&hardwareDeviceId的值（只填写值，中间用&连接）
 * 请注意：吉利银河app异地登录会顶下去，每次重新登录都要重新抓包。抓包教程自己找，安卓1.26.1版本app实测不需要根证书，用户证书也能抓，可能要配合PC端Reqable。

 * 2. 在青龙面板中添加定时任务：
 *    - 名称：jlyh
 *    - 命令：jlyh.js
 *    - 按需设置定时(不会设置问GPT)
 *    - 如果不带任何参数运行脚本，将按默认执行方式执行（通过下方变量配置）
 *    - 如果带参数运行脚本，将执行对应功能
 *    - 例如：
 *    - jlyh.js all 将执行所有功能
 *    - jlyh.js mqtt 将开启MQTT监听（这个要单独开）
 *    - jlyh.js info 将只执行信息获取功能
 *    - jlyh.js sign 将只执行签到功能
 *    - jlyh.js opensentry 将执行打开哨兵功能
 *    - jlyh.js photo 将获取驻车图片
 *    - jlyh.js startcharge 启动充电（默认第一个桩）
 *    - jlyh.js stopcharge 停止充电（默认第一个桩）
 *    - jlyh.js startcharge 70210159749 启动指定桩号充电
 *    - jlyh.js stopcharge 70210159749 停止指定桩号充电
 *    - jlyh.js sign opensentry 将执行签到和哨兵功能
 
 * 3. 通知控制
 *    以下两种方式均可控制通知：
 *    - 修改此处默认值：
 *    - Notify = 0  默认通知设置（仅在重要场景如哨兵开启、签到成功时通知）
 *    - Notify = 1  强制开启通知（所有场景都会通知）
 *    - Notify = 2  强制关闭通知（所有场景都不通知）
 *    - 使用命令行参数：
 *    - jlyh.js notify=1  强制开启通知
 *    - jlyh.js notify=2  强制关闭通知
 * 
 * 4. MQTT配置
 *    - 在下方配置位置输入MQTT地址端口以及状态更新间隔（建议60秒左右）
 *    - 在HomeAssistant中添加MQTT代理，并配置MQTT客户端
 *    - 如果设置了自动监听，开启脚本后将自动生成实体
 **/

// *********************************************************
// 各类变量的构造

let Notify = 0;
let defaultRunAll = false;  // 默认执行模式：false 表示使用 defaultFeatures 配置，true 表示执行所有功能
let defaultFeatures = ['info', 'photo'];  // 当 defaultRunAll=false 时，默认执行的功能列表，可配置多个，如：['info', 'sign', 'opensentry']
let defaultEnableMqtt = true; // 默认MQTT模式：false 表示默认不启动MQTT监听，true 表示默认启动
let showInfoLogs = false; // 控制是否在执行功能时显示信息获取相关的日志，默认如果执行功能则不显示
const ckName = "jlyh";
const $ = new Env("吉利银河");
let msg = "";

// 添加时间格式化函数
function getFormattedTimestamp() {
    return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Shanghai', hour12: false }).replace(',', '').slice(0, 16).replace(/-/g, '/');
}

// MQTT配置
const mqttConfig = {
    host: 'mqtt://', // MQTT服务器地址
    port: 1883,                 // MQTT服务器端口
    username: 'XXXXX',               // MQTT用户名
    password: 'XXXXX',               // MQTT密码
    clientId: 'jlyh_geely_galaxy', // 固定客户端ID
    updateInterval: 60         // MQTT状态更新间隔，单位：秒
};

class UserInfo {
        
    // 车主信息相关变量构造
    constructor(str) {
        this.ckStatus = true;
        this.token = '';
        this.refreshToken = str.split('&')[0]; // 分隔符
        this.articleId = '';
        this.deviceSN = str.split('&')[1];
        this.switchStatus = {};  // 用于存储所有功能开关状态
        this.vehicleInfo = {};   // 用于存储车辆信息
        this.vehicleStatus = {}; // 用于存储车辆状态信息
        this.firstTokenRefresh = true; // 添加标记，用于跟踪是否是首次刷新token
        // 功能名称映射
        this.featureNames = {
            'sign': '签到',
            'opensentry': '打开哨兵',
            'closesentry': '关闭哨兵',
            'opendoor': '打开车锁',
            'closedoor': '关闭车锁',
            'search': '闪灯鸣笛',
            'windowslightopen': '微开车窗',
            'windowfullopen': '全开车窗',
            'windowclose': '关闭车窗',
            'sunroofopen': '打开天窗',
            'sunroofclose': '关闭天窗',
            'sunshadeopen': '打开遮阳帘',
            'sunshadeclose': '关闭遮阳帘',
            'purifieropen': '打开净化',
            'purifierclose': '关闭净化',
            'defrostopen': '打开除霜',
            'defrostclose': '关闭除霜',
            'aconopen': '打开空调',
            'aconclose': '关闭空调',
            'rapidheat': '极速升温',
            'rapidcool': '极速降温',
            'photo': '获取驻车图片',
            'startcharge': '启动充电',
            'stopcharge': '停止充电',
            'capability': '车辆能力查询',
            'deviceinfo': '车机设备信息'
            // 如果要新增功能，在这里添加新功能的映射即可,不添加则会直接显示函数名
        };
        // 功能开关状态映射
        this.switchStatusNames = {
            'vstdModeStatus': { name: '哨兵模式' },
            'strangerModeActive': { name: '陌生人预警' },
            'campingModeActive': { name: '露营模式' },
            'jouIntVal': { name: '智能巡航' },
            'copActive': { name: '舒适泊车' },
            'parkingComfortStatus': { name: '泊车舒适性' },
            'ldacStatus': { name: '高清音频' },
            'driftModeActive': { name: '漂移模式' },
            'carLocatorStatUploadEn': { name: '车辆定位' },
            'prkgCameraActive': { name: '泊车影像' }
        };
        // 车辆信息映射
        this.vehicleInfoNames = {
            'vin': { name: '车架号' },
            'seriesNameVs': { name: '车型' },
            'colorCode': { name: '车身颜色' },
            'engineNo': { name: '电机编号' }
        };
        // 车辆状态映射
        this.vehicleStatusNames = {
            basicVehicleStatus: {
                name: '基础状态',
                fields: {
                    distanceToEmptyOnBatteryOnly: { name: '续航里程', format: v => `${v}公里` },
                    odometer: { name: '总里程', format: v => `${Math.round(v)}公里` },
                    usageMode: { name: '使用模式', format: v => v === '1' ? '正常模式' : `模式${v}` }
                }
            },
            vehicleLocationStatus: {
                name: '位置信息',
                fields: {
                    longitude: { name: '经度', format: v => (v / 3600000).toFixed(6) },
                    latitude: { name: '纬度', format: v => (v / 3600000).toFixed(6) },
                    altitude: { name: '海拔', format: v => `${v}米` }
                }
            },
            vehicleMaintainStatus: {
                name: '保养信息',
                fields: {
                    distanceToService: { name: '剩余保养里程', format: v => `${v}公里` },
                    daysToService: { name: '剩余保养天数', format: v => `${v}天` }
                }
            },
            vehicleRunningStatus: {
                name: '行驶状态',
                fields: {
                    speed: { name: '当前速度', format: v => `${v}km/h` },
                    avgSpeed: { name: '近期平均速度', format: v => `${v}km/h` },
                    averPowerConsumption: { name: '近期平均能耗', format: v => `${v}kWh/100km` },
                    tripMeter1: { name: '行程1', format: v => `${v}km` },
                    tripMeter2: { name: '行程2', format: v => `${v}km` },
                    averTraPowerConsumption: { name: '行程平均能耗', format: v => `${v}kWh/100km` },
                    electricParkBrakeStatus: { name: '电子手刹', format: v => v === 1 ? '启用' : '未启用' },
                    gearAutoStatus: { name: '自动挡位', format: v => v }
                }
            },
            
            vehicleEnvironmentStatus: {
                name: '环境状态',
                fields: {
                    interiorTemp: { name: '车内温度', format: v => `${v}°C` },
                    exteriorTemp: { name: '车外温度', format: v => `${v}°C` },
                    interiorPM25Level: { name: '车内PM2.5', format: v => `${v}μg/m³` }
                }
            },
            vehicleBatteryStatus: {
                name: '电池状态',
                fields: {
                    chargeLevel: { name: '当前电量', format: v => `${v}%` },
                    timeToFullyCharged: { name: '充满时间', format: v => v === '2047' ? '未充电' : `${(v/60).toFixed(1)}小时` },
                    dcChargeIAct: { name: '充电电流', format: v => `${v}A` }
                }
            },
            vehicleDoorCoverStatus: {
                name: '车门状态',
                fields: {
                    doorLockStatusDriver: { name: '门锁', format: v => v === '2' ? '已锁定' : '已解锁' },
                    sunroofStatus: { name: '天窗状态', format: v => v === '1' ? '打开' : '关闭' },
                    sunshadeStatus: { name: '遮阳帘状态', format: v => v === '1' ? '打开' : '关闭' },
                    trunkLockStatus: { name: '后备箱锁', format: v => v === '1' ? '解锁' : '锁定' }
                }
            },
            vehicleEngineStatus: {
                name: '电机状态',
                fields: {
                    engineStatus: { name: '电机', format: v => v === 'engine-off' ? '关闭' : '开启' }
                }
            },
            vehicleClimateStatus: {
                name: '空调状态',
                fields: {
                    preClimateActive: { name: '空调', format: v => v ? '开启' : '关闭' },
                    defrostActive: { name: '除霜', format: v => v ? '开启' : '关闭' },
                    airBlowerActive: { name: '净化', format: v => v ? '开启' : '关闭' }
                }
            }
        };
        this.mqttClient = null; // 添加MQTT客户端实例变量
        this.rechargeToken = ''; // 充电模块token
        this.rechargeRefreshToken = ''; // 充电模块refreshToken
        this.rechargeTokenExpiry = 0; // 充电模块token过期时间戳
        this.rechargeUserId = ''; // 充电模块用户ID
        this.chargingPiles = []; // 充电桩列表
        
        // 添加状态检测映射
        this.statusChecks = {
            sentry: () => this.switchStatus.vstdModeStatus === '1',
            door: () => this.vehicleStatus.vehicleDoorCoverStatus?.doorLockStatusDriver === '1',  // 1表示解锁(ON)，2表示锁定(OFF)
            ac: () => this.vehicleStatus.vehicleClimateStatus?.preClimateActive === true,
            defrost: () => this.vehicleStatus.vehicleClimateStatus?.defrostActive === true,
            purifier: () => this.vehicleStatus.vehicleClimateStatus?.airBlowerActive === true,
            sunroof: () => this.vehicleStatus.vehicleDoorCoverStatus?.sunroofStatus === '1',  // 1表示打开(ON)，2表示关闭(OFF)
            sunshade: () => this.vehicleStatus.vehicleDoorCoverStatus?.sunshadeStatus === '1'  // 1表示打开(ON)，2表示关闭(OFF)
        };
    }

    // *********************************************************
    // 加密解密等后端功能相关

    // 获取UTC时间
    formatDate(date, hourOffset = 0, minuteOffset = 0) {
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const adjustedDate = new Date(date);
        adjustedDate.setUTCHours(adjustedDate.getUTCHours() + hourOffset);
        adjustedDate.setUTCMinutes(adjustedDate.getUTCMinutes() + minuteOffset);
        const dayOfWeek = daysOfWeek[adjustedDate.getUTCDay()];
        const day = ('0' + adjustedDate.getUTCDate()).slice(-2);
        const month = months[adjustedDate.getUTCMonth()];
        const year = adjustedDate.getUTCFullYear();
        const hours = ('0' + adjustedDate.getUTCHours()).slice(-2);
        const minutes = ('0' + adjustedDate.getUTCMinutes()).slice(-2);
        const seconds = ('0' + adjustedDate.getUTCSeconds()).slice(-2);
        return `${dayOfWeek} ${month} ${day} ${year} ${hours}:${minutes}:${seconds} GMT`;
    }

    // 请求头加密参数处理
    calculateHmacSha256(method, accept, content_md5, content_type, date, key, nonce, timestamp, path, appcode = null) {
        const crypto = require('crypto');
        // 构建待加密的字符串
        let ee = `${method}\n` +// method
            `${accept}\n` +// accept
            `${content_md5}\n` +// content_md5
            `${content_type}\n` +// content_type
            `${date}\n` +// date
            (appcode ? `x-ca-appcode:${appcode}\n` : '') + // 如果有appcode则添加
            `x-ca-key:${key}\n` +
            `x-ca-nonce:${nonce}\n` +// nonce
            `x-ca-timestamp:${timestamp}\n` +// timestamp
            `${path}`// path
        // console.log(ee);

        // app的Key对应的不同加密编码
        let sercetKey
        if (key == 204453306) {
            sercetKey = `uUwSi6m9m8Nx3Grx7dQghyxMpOXJKDGu`
        } else if (key == 204373120) {
            sercetKey = `XfH7OiOe07vorWwvGQdCqh6quYda9yGW`
        } else if (key == 204167276) {
            sercetKey = `5XfsfFBrUEF0fFiAUmAFFQ6lmhje3iMZ`
        } else if (key == 204168364) {
            sercetKey = `NqYVmMgH5HXol8RB8RkOpl8iLCBakdRo`
        } else if (key == 204179735) {
            sercetKey = `UhmsX3xStU4vrGHGYtqEXahtkYuQncMf`
        } else if (key == 204195485) {
            sercetKey = `CqPwP83wzdjesmLeDuzK6SljsYN5PvRM`
        }
        // 生成 HMAC-SHA256 加密结果
        const hmacSha256 = crypto.createHmac('sha256', sercetKey);
        hmacSha256.update(ee);
        const encryptedData = hmacSha256.digest();
        // 返回 Base64 编码的结果
        // console.log(`加密结果` + encryptedData.toString('base64'));
        return encryptedData.toString('base64');
    }

    // UUID生成
    generateUUID() {
        const alphanumeric = "0123456789abcdef";
        const sections = [8, 4, 4, 4, 12];
        let uuid = "";
        for (let i = 0; i < sections.length; i++) {
            for (let j = 0; j < sections[i]; j++) {
                uuid += alphanumeric[Math.floor(Math.random() * alphanumeric.length)];
            }
            if (i !== sections.length - 1) {
                uuid += "-";
            }
        }
        return uuid;
    }

    // Post请求构建
    getPostHeader(key, path, body) {
        const crypto = require('crypto');
        function calculateContentMD5(requestBody) {
            // 将请求体内容转换为字节数组
            const byteArray = Buffer.from(requestBody, 'utf8');
            // 计算字节数组的MD5摘要
            const md5Digest = crypto.createHash('md5').update(byteArray).digest();
            // 将MD5摘要转换为Base64编码的字符串
            const md5Base64 = md5Digest.toString('base64');
            // 返回Content-MD5值
            return md5Base64;
        }
        let currentDate = new Date();
        let formattedDate = this.formatDate(currentDate, 0); // 格林尼治时间  如果是8则是北京时间
        // console.log(formattedDate);
        let parts = formattedDate.split(" ");
        formattedDate = `${parts[0]}, ${parts[2]} ${parts[1]} ${parts[3]} ${parts[4]} GMT`;
        let date = new Date(formattedDate)
        let timestamp = date.getTime(); // 获取时间戳
        // console.log(timestamp);
        let content_md5 = calculateContentMD5(body);
        let uuid = this.generateUUID();

        // 根据不同的key设置不同的签名头字段
        let signatureHeaders;
        if (key == 204373120) {
            // vc域名使用这个签名头
            signatureHeaders = 'x-ca-appcode,x-ca-nonce,x-ca-timestamp,x-ca-key';
        } else if (key == 204195485) {
            // 充电模块
            signatureHeaders = 'x-ca-key,x-ca-nonce,x-ca-timestamp';
        } else {
            // 其他域名使用这个签名头
            signatureHeaders = 'x-ca-nonce,x-ca-key,x-ca-timestamp';
        }

        // Determine appcode based on key for signature calculation
        let appcode = key == 204373120 ? 'usp-gateway-code' : null;
        let contentType = key == 204195485 ? "application/json; charset=UTF-8" : "application/json; charset=utf-8";
        let signature = this.calculateHmacSha256("POST", "application/json; charset=utf-8", content_md5, contentType, formattedDate, key, uuid, timestamp, path, appcode)
        let headers = {
            'date': formattedDate,
            'x-ca-signature': signature,
            'x-ca-appcode': key == 204373120 ? 'usp-gateway-code' : 'SWGeelyCode',
            'x-ca-nonce': uuid,
            'x-ca-key': key,
            'ca_version': 1,
            'accept': 'application/json; charset=utf-8',
            'usetoken': 1,
            'content-md5': content_md5,
            'x-ca-timestamp': timestamp,
            'x-ca-signature-headers': signatureHeaders,
            'x-refresh-token': true,
            'user-agent': 'ALIYUN-ANDROID-UA',
            'token': this.token,
            'deviceSN': this.deviceSN,
            'txCookie': '',
            'appId': 'galaxy-app',
            'appVersion': '1.39.0',
            'platform': 'Android',
            'Cache-Control': 'no-cache',
            'sweet_security_info': '{"appVersion":"1.27.0","platform":"android"}' ,
            'methodtype': '6',
            'contenttype': 'application/json',
            'Content-Type': contentType,
           'Content-Length': '87',
            'Connection': 'Keep-Alive',
            'Accept-Encoding': 'gzip',

        }


        if (key == 204179735) {
            // 安卓端
            headers["usetoken"] = true
            headers["host"] = `galaxy-user-api.geely.com`
            delete headers["x-refresh-token"]
            headers["taenantid"] = 569001701001
            headers["svcsid"] = ""
        } else if (key == 204373120) {
            // vc域名(驻车图片等功能)
            headers["usetoken"] = 1
            headers["host"] = `galaxy-vc.geely.com`
            headers["x-refresh-token"] = true
        } else if (key == 204195485) {
            // 充电模块
            headers["host"] = `api-recharge.geely.com`
            headers["channelid"] = "01701001"
            headers["token"] = this.rechargeToken || ''
            delete headers["x-ca-appcode"]
            delete headers["x-refresh-token"]
            delete headers["sweet_security_info"]
            delete headers["methodtype"]
            delete headers["contenttype"]
            delete headers["appId"]
            delete headers["appVersion"]
            delete headers["platform"]
            delete headers["deviceSN"]
            delete headers["txCookie"]
            delete headers["Content-Length"]
        } else {
            // h5端
            headers["usetoken"] = 1
            headers["host"] = `galaxy-app.geely.com`
            headers["x-refresh-token"] = true
        }
        return headers;

    }

    // Get请求构建
    getGetHeader(key, path) {
        let currentDate = new Date();
        let formattedDate = this.formatDate(currentDate, 0); // 格林尼治时间  如果是8则是北京时间
        // console.log(formattedDate);
        let parts = formattedDate.split(" ");
        formattedDate = `${parts[0]}, ${parts[2]} ${parts[1]} ${parts[3]} ${parts[4]} GMT`;
        let date = new Date(formattedDate)
        let timestamp = date.getTime(); // 获取时间戳
        // console.log(timestamp);
        let uuid = this.generateUUID();
        let signature = this.calculateHmacSha256("GET", "application/json; charset=utf-8", "", "application/x-www-form-urlencoded; charset=utf-8", formattedDate, key, uuid, timestamp, path)
        let headers = {
            'date': formattedDate,
            'x-ca-signature': signature,
            'x-ca-nonce': uuid,
            'x-ca-key': key,
            'ca_version': 1,
            'accept': 'application/json; charset=utf-8',
            'usetoken': 1,
            'x-ca-timestamp': timestamp,
            'x-ca-signature-headers': 'x-ca-nonce,x-ca-timestamp,x-ca-key',
            'x-refresh-token': true,
            'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
            'user-agent': 'ALIYUN-ANDROID-UA',
            'token': this.token,// '',
            'deviceSN': this.deviceSN,
            'txCookie': '',
            'appId': 'galaxy-app',
            'appVersion': '1.39.0',
            'platform': 'Android',
            'Cache-Control': 'no-cache',
            'Connection': 'Keep-Alive',
            'Accept-Encoding': 'gzip',
            
        }

        if (key == 204179735) {
            // 安卓端
            headers["usetoken"] = true
            headers["host"] = `galaxy-user-api.geely.com`
            delete headers["x-refresh-token"]
            headers["taenantid"] = 569001701001
            headers["svcsid"] = ""
        } else if (key == 204195485) {
            // 充电模块
            headers["host"] = `api-recharge.geely.com`
            headers["channelid"] = "01701001"
            headers["token"] = this.rechargeToken || ''
            headers["x-ca-signature-headers"] = 'x-ca-key,x-ca-nonce,x-ca-timestamp'
            delete headers["x-refresh-token"]
            delete headers["appId"]
            delete headers["appVersion"]
            delete headers["platform"]
            delete headers["deviceSN"]
            delete headers["txCookie"]
        } else {
            headers["usetoken"] = 1
            headers["host"] = `galaxy-app.geely.com`
            headers["x-refresh-token"] = true

        }
        return headers

    }

    /**
     * -------主函数-------
     */
    async main(features = []) {
        $.DoubleLog(`⌛️ ${getFormattedTimestamp()}`);

        // 如果没有传入参数，使用默认配置
        if (features.length === 0) {
            if (defaultRunAll) {
                features = ['all'];  // 执行所有功能
            } else {
                features = defaultFeatures;  // 使用配置的默认功能列表
            }
        }

        // 从功能列表中过滤掉 'info'，因为它不是一个执行函数，而是用于控制日志显示
        const hasInfo = features.includes('info');
        features = features.filter(f => f !== 'info');

        // 设置是否显示信息获取日志
        showInfoLogs = hasInfo || features.length === 0;
        // 检查是否需要启动MQTT
        const isMqttMode = features.length === 0 ? defaultEnableMqtt : features.length === 1 && features.includes('mqtt');

        // 显示运行功能说明
        this.logRunningFeatures(features);
        // 刷新token并获取基本信息
        await this.refresh_token();
        if (!this.ckStatus) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 账号CK失效`);
            Notify = 1;
            return;
        }
        // 获取各种车辆信息
        await this.getVehicleInfo();
        // 根据配置决定是否初始化MQTT连接
        if (isMqttMode) {
            await this.initMqtt();
            // 保持脚本运行
            return new Promise(() => {
                $.DoubleLog(`✅ ${getFormattedTimestamp()} MQTT监听已启动，等待命令中...`);
            });
        }
        // 执行功能
        await this.executeFeatures(features);
    }

    // 记录运行的功能
    logRunningFeatures(features) {
        if (features.length === 0) {
            $.DoubleLog(`🔄 ${getFormattedTimestamp()} 正在获取车辆信息`);
        } else if (features.includes('all')) {
            $.DoubleLog(`🔄 ${getFormattedTimestamp()} 正在运行全部功能`);
        } else {
            const runningFeatures = features
                .map(f => this.featureNames[f.toLowerCase()] || f)
                .filter(name => name);
            if (runningFeatures.length > 0) {
                $.DoubleLog(`🔄 ${getFormattedTimestamp()} 正在运行${runningFeatures.join('、')}功能`);
            }
        }
    }

    // 获取车辆信息
    async getVehicleInfo() {
        // 只在显示信息日志时显示分割线
        if (showInfoLogs) {
            $.DoubleLog(`🚗🚗🚗🚗🚗🚗🚗🚗🚗🚗`);
        }
        await this.mylist();        // 获取车辆信息
        await this.controlstatus(); // 获取车辆状态信息
        await this.switchstatus();  // 获取车辆功能开关信息
        await this.getLastSoc();    // 获取最新SOC电量
    }

    // 执行功能
    async executeFeatures(features) {
        if (features.length === 0) {
            return; // 如果是仅查询信息，直接返回
        }
        $.DoubleLog(`🚗🚗🚗🚗🚗🚗🚗🚗🚗🚗`);
        if (features.includes('all')) {
            $.DoubleLog(`🔄 ${getFormattedTimestamp()} 正在执行所有功能...`);
            await this.sign();
            await this.opensentry();
            // 只在MQTT启用时发送状态
            if (defaultEnableMqtt || features.includes('mqtt')) {
                await this.sendVehicleStatusMqtt();
            }
        } else {
            $.DoubleLog(`🔄 ${getFormattedTimestamp()} 正在执行功能...`);
            for (let i = 0; i < features.length; i++) {
                const feature = features[i];
                const methodName = feature.toLowerCase();
                // 充电桩命令支持追加桩号参数
                if ((methodName === 'startcharge' || methodName === 'stopcharge') && typeof this[methodName] === 'function') {
                    // 下一个参数如果不是已知功能名，则视为充电桩ID
                    let pileId = null;
                    if (i + 1 < features.length && !this.featureNames[features[i + 1].toLowerCase()] && typeof this[features[i + 1].toLowerCase()] !== 'function') {
                        pileId = features[i + 1];
                        i++; // 跳过桩号参数
                    }
                    await this[methodName](pileId);
                } else if (methodName && typeof this[methodName] === 'function') {
                    await this[methodName]();
                    // 只在MQTT启用且执行特定功能时发送状态
                    if ((defaultEnableMqtt || features.includes('mqtt')) && ['controlstatus', 'info'].includes(methodName)) {
                        await this.sendVehicleStatusMqtt();
                    }
                } else {
                    $.DoubleLog(`❌ ${getFormattedTimestamp()} 未知的功能参数: ${feature}`);
                    Notify = 1;
                }
            }
        }
    }

    // *********************************************************
    // 信息获取类函数

    // 刷新Key函数
    async refresh_token() {
        try {
            let options = {
                url: `https://galaxy-user-api.geely.com/api/v1/login/refresh?refreshToken=${this.refreshToken}`,
                headers: this.getGetHeader(204179735, `/api/v1/login/refresh?refreshToken=${this.refreshToken}`),
            },
                result = await httpRequest(options);
            
            if (result.code == 'success') {
                // 简化成功消息，不再输出token详情
                this.ckStatus = true;
                this.token = result.data.centerTokenDto.token;
                
                // 只在首次刷新token时显示日志
                if (this.firstTokenRefresh) {
                    const randomId = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
                    $.DoubleLog(`✅ ${getFormattedTimestamp()} 接口调用成功: ${randomId}`);
                    $.DoubleLog(`🆗刷新KEY:${result.data.centerTokenDto.refreshToken}`);
                    this.firstTokenRefresh = false; // 标记已经不是首次刷新了
                }
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} ${result.message}`);
                this.ckStatus = false;
                console.log(result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e)
        }
    }

    //获取车辆信息函数
    async mylist() {
        try {
            // 准备请求体
            const body = {};

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/myList`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/myList`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            let result = await httpRequest(options);

            if (result.code == 0) {
                if (showInfoLogs) $.DoubleLog(`✅ ${getFormattedTimestamp()} 获取车辆基本信息成功！`);
                // 显示原始返回信息
                if (showInfoLogs) $.DoubleLog(`🔍 ${getFormattedTimestamp()} 车辆信息原始数据: ${JSON.stringify(result.data)}`);
                
                if (result.data && result.data.length > 0) {
                    this.vehicleInfo = result.data[0];  // 保存车辆信息
                    
                    // 格式化显示车辆信息
                    if (showInfoLogs) {
                        $.DoubleLog(`🚗 ${getFormattedTimestamp()} 车辆基本信息：`);
                        for (const [key, value] of Object.entries(this.vehicleInfoNames)) {
                            if (this.vehicleInfo[key]) {
                                $.DoubleLog(`  ${value.name}: ${this.vehicleInfo[key]}`);
                            }
                        }
                    }
                } else {
                    $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取车辆信息失败，未找到车辆数据！`);
                    Notify = 1;
                }
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取车辆基本信息失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    // 查询车辆状态函数
    async controlstatus() {
        try {
            // 准备请求体
            const body = {
                "clientType": 2,
                "statusType": "local",
                "dataTypeList": [
                    "all"
                ],
                "vin": this.vehicleInfo.vin
            };
            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/status`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/status`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            let result = await httpRequest(options);

            if (result.code == 0) {
                if (showInfoLogs) $.DoubleLog(`✅ ${getFormattedTimestamp()} 查询车辆状态成功！`);
                // 显示原始返回信息
                if (showInfoLogs) $.DoubleLog(`🔍 ${getFormattedTimestamp()} 车辆状态原始数据: ${JSON.stringify(result.data)}`);
                
                // 保存车辆状态信息
                this.vehicleStatus = result.data;
                
                // 格式化显示车辆状态信息
                if (showInfoLogs) {
                    for (const [category, config] of Object.entries(this.vehicleStatusNames)) {
                        if (this.vehicleStatus[category]) {
                            $.DoubleLog(`📱${config.name}：`);
                            for (const [field, fieldConfig] of Object.entries(config.fields)) {
                                const value = this.vehicleStatus[category][field];
                                if (value !== undefined && value !== '') {
                                    $.DoubleLog(`  ${fieldConfig.name}: ${fieldConfig.format(value)}`);
                                }
                            }
                        }
                    }
                }
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 查询车辆状态失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    // 查询车辆功能开关函数
    async switchstatus() {
        try {
            // 通用的状态配置
            const commonStatus = {
                status: {'0': '关闭', '1': '开启'},
                isEnabled: (value) => value === '1'
            };

            // 准备请求体
            const body = {
                "clientType": 2,
                "udid": null,
                "vin": this.vehicleInfo.vin
            };
            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/switch/status`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/switch/status`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 查询车辆功能开关
            let result = await httpRequest(options);

            if (result.code == 0) {
                if (showInfoLogs) $.DoubleLog(`✅ ${getFormattedTimestamp()} 查询车辆功能开关成功！`);
                // 显示原始返回信息
                if (showInfoLogs) $.DoubleLog(`🔍 ${getFormattedTimestamp()} 功能开关原始数据: ${JSON.stringify(result.data)}`);
                
                // 保存所有功能开关状态
                this.switchStatus = result.data;
                
                // 格式化显示功能开关状态
                if (showInfoLogs) {
                    $.DoubleLog(`📱 ${getFormattedTimestamp()} 功能开关状态：`);
                    for (const [key, value] of Object.entries(result.data)) {
                        if (this.switchStatusNames[key]) {
                            const statusInfo = { ...this.switchStatusNames[key], ...commonStatus };
                            $.DoubleLog(`  ${statusInfo.name}: ${statusInfo.status[value] || value}`);
                        }
                    }
                }
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 查询车辆功能开关失败！`);
                console.log("⚠️失败原因:",result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    // 查询车辆能力列表
    async capability() {
        try {
            const body = {
                "clientType": 2,
                "vin": this.vehicleInfo.vin
            };
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/capability`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/capability`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };
            let result = await httpRequest(options);
            if (result.code == 0 && result.data) {
                this.vehicleCapability = result.data;
                $.DoubleLog(`✅ ${getFormattedTimestamp()} 查询车辆能力成功！`);
                if (result.data.baseList) {
                    $.DoubleLog(`📱 支持功能：共${result.data.baseList.length}项`);
                    for (const item of result.data.baseList) {
                        if (item.isVisible === '1') {
                            $.DoubleLog(`  ${item.functionName || item.functionId}: ${item.isSubscribe === '1' ? '已订阅' : '未订阅'}`);
                        }
                    }
                }
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 查询车辆能力失败！`);
            }
        } catch (e) {
            console.log(e);
        }
    }

    // 获取最新SOC电量（比control/status更实时）
    async getLastSoc() {
        try {
            const body = {
                "clientType": 2,
                "password": null,
                "platform": "2.0",
                "sourceType": 1,
                "type": null,
                "udId": null,
                "vin": this.vehicleInfo.vin
            };
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/reservation/getLastSoc`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/reservation/getLastSoc`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };
            let result = await httpRequest(options);
            if (result.code == 0 && result.data) {
                this.lastSoc = result.data.targetSOCVal;
                if (showInfoLogs) {
                    $.DoubleLog(`✅ ${getFormattedTimestamp()} 最新SOC: ${result.data.targetSOCVal}%`);
                }
                return result.data.targetSOCVal;
            } else {
                if (showInfoLogs) $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取SOC失败！`);
                return null;
            }
        } catch (e) {
            console.log(e);
            return null;
        }
    }

    // 获取车机设备信息
    async deviceinfo() {
        try {
            const body = {
                "carSeriesCode": this.vehicleInfo.seriesCode || "E245",
                "brandCode": "GALAXY"
            };
            let options = {
                url: `https://galaxy-vc.geely.com/vc/api/v1/carAdapter/getDeviceInfo`,
                headers: this.getPostHeader(204373120, `/vc/api/v1/carAdapter/getDeviceInfo`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };
            let result = await httpRequest(options);
            if (result.code == 0 && result.data) {
                this.deviceInfo = result.data;
                $.DoubleLog(`✅ ${getFormattedTimestamp()} 车机设备信息：`);
                for (const device of result.data) {
                    $.DoubleLog(`  设备型号: ${device.deviceModel}`);
                    $.DoubleLog(`  WiFi名称: ${device.wifiName}`);
                    $.DoubleLog(`  WiFi密码: ${device.wifiPwd}`);
                    $.DoubleLog(`  固件版本: ${device.version}`);
                }
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取车机设备信息失败！`);
                console.log("⚠️失败原因:", result);
            }
        } catch (e) {
            console.log(e);
        }
    }

    //查询积分函数
    async points() {
        try {
            let options = {
                url: `https://galaxy-app.geely.com/h5/v1/points/get`,
                headers: this.getGetHeader(204453306, `/h5/v1/points/get`),
            },
                result = await httpRequest(options);
            // console.log(options);
            // console.log(result);
            if (result.code == 0) {
                $.DoubleLog(`✅ ${getFormattedTimestamp()} 剩余积分: ${result.data.availablePoints}`);
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 剩余积分查询: 失败`);
                console.log(result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }


    // 签到状态查询函数
    async signstate() {
        try {
            let options = {
                url: `https://galaxy-app.geely.com/app/v1/sign/state`,
                headers: this.getGetHeader(204453306, `/app/v1/sign/state`),
            };

            // 执行签到状态查询请求
            let result = await httpRequest(options);

            if (result.code == 0) {
                if (result.data === true) {
                    $.DoubleLog(`✅ ${getFormattedTimestamp()} 今日已经签到啦！`);
                    return true;
                } else {
                    return false;
                }
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 查询签到状态失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
                return false;
            }
        } catch (e) {
            console.log(e);
            return false;
        }
    }

    // *********************************************************
    // 功能完成类函数

    //签到函数
    async sign() {
        try {
            // 先检查签到状态
            const hasSignedToday = await this.signstate();
            if (hasSignedToday) {
                // 即使已经签到，也查询一下积分
                await this.points();
                return;
            }

            // 准备请求体
            const body = {
                "signType": 0
            };

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-app.geely.com/app/v1/sign/add`,
                headers: this.getPostHeader(204453306, `/app/v1/sign/add`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行签到请求
            let result = await httpRequest(options);
            
            // 检查返回结果
            if (result.code == 0) {
                $.DoubleLog(`✅ ${getFormattedTimestamp()} 签到成功！`);
                // 签到成功后查询积分
                await this.points();
                Notify = 1;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 签到失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }
    

    //打开哨兵模式函数
    async opensentry() {
        try {
            // 检查哨兵模式是否已开启
            if (this.switchStatus.vstdModeStatus === '1') {
                $.DoubleLog(`ℹ️哨兵模式开着呢！`);
                return;
            }
            
            // 从车辆状态中获取电量
            const batteryLevel = parseFloat(this.vehicleStatus.vehicleBatteryStatus?.chargeLevel || 0);
            if (batteryLevel <= 20) {
                $.DoubleLog(`ℹ️电量低，别开哨兵了！`);
                return;
            }

            // 准备请求体
            const body = {
                "clientType": 2,
                "command": "1",
                "password": null,
                "tspUid": null,
                "type": 6,
                "udId": null,
                "vin": this.vehicleInfo.vin
            };

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/switch`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/switch`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行哨兵请求
            let result = await httpRequest(options);

            if (result.code == 0) {
                $.DoubleLog(`✅ ${getFormattedTimestamp()} 打开哨兵模式成功！`);
                Notify = 1;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 打开哨兵模式失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    //关闭哨兵模式函数
    async closesentry() {
        try {
            // 准备请求体
            const body = {
                "clientType": 2,
                "command": "2",
                "password": null,
                "tspUid": null,
                "type": 6,
                "udId": null,
                "vin": this.vehicleInfo.vin
            };

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/switch`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/switch`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行关闭哨兵请求
            let result = await httpRequest(options);

            if (result.code == 0) {
                $.DoubleLog(`✅ ${getFormattedTimestamp()} 关闭哨兵模式成功！`);
                Notify = 1;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 关闭哨兵模式失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    //车锁控制通用函数
    async controlDoor(action) {
        try {
            // 根据动作设置参数
            const params = {
                'opendoor': { type: 1, name: '打开' },
                'closedoor': { type: 2, name: '关闭' }
            }[action];

            if (!params) {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 无效的车锁控制命令！`);
                return;
            }

            // 准备请求体
            const body = {
                "clientType": 2,
                "lockPassword": null,
                "password": null,
                "platform": "2.0",
                "position": 0,
                "target": null,
                "type": params.type,
                "udId": null,
                "vin": this.vehicleInfo.vin
            };

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/door`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/door`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行车锁控制请求
            let result = await httpRequest(options);

            if (result.code == 0) {
                $.DoubleLog(`✅${params.name}车锁成功！`);
                Notify = 1;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} ${params.name}车锁失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    //打开车锁函数
    async opendoor() {await this.controlDoor('opendoor');}
    //关闭车锁函数
    async closedoor() {await this.controlDoor('closedoor');}

    //闪灯鸣笛函数
    async search() {
        try {
            // 准备请求体
            const body = {
                "clientType": 2,
                "password": null,
                "platform": "2.0",
                "udId": null,
                "value": "3",
                "vin": this.vehicleInfo.vin
            };

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/search`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/search`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行闪灯鸣笛请求
            let result = await httpRequest(options);

            if (result.code == 0) {
                $.DoubleLog(`✅ ${getFormattedTimestamp()} 闪灯鸣笛执行成功！`);
                Notify = 1;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 闪灯鸣笛执行失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    //车窗控制通用函数
    async controlWindow(action) {
        try {
            // 根据动作设置参数
            const params = {
                'windowslightopen': { position: [4], type: 1, name: '微开车窗' },
                'windowfullopen': { position: [1], type: 1, name: '全开车窗' },
                'windowclose': { position: [1], type: 2, name: '关闭车窗' },
                'sunroofopen': { position: [2], type: 1, name: '打开天窗' },
                'sunroofclose': { position: [2], type: 2, name: '关闭天窗' },
                'sunshadeopen': { position: [3], type: 1, name: '打开遮阳帘' },
                'sunshadeclose': { position: [3], type: 2, name: '关闭遮阳帘' }
            }[action];

            if (!params) {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 无效的车窗控制命令！`);
                return;
            }

            // 准备请求体
            const body = {
                "clientType": 2,
                "password": null,
                "percent": null,
                "platform": "2.0",
                "position": params.position,
                "type": params.type,
                "udId": null,
                "vin": this.vehicleInfo.vin
            };

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/window`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/window`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行车窗控制请求
            let result = await httpRequest(options);

            if (result.code == 0) {
                $.DoubleLog(`✅${params.name}执行成功！`);
                Notify = 1;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} ${params.name}执行失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    // 微开车窗函数
    async windowslightopen() {await this.controlWindow('windowslightopen');}
    // 全开车窗函数
    async windowfullopen() {await this.controlWindow('windowfullopen');}
    // 关闭车窗函数
    async windowclose() {await this.controlWindow('windowclose');}
    // 打开天窗函数
    async sunroofopen() {await this.controlWindow('sunroofopen');}
    // 关闭天窗函数
    async sunroofclose() {await this.controlWindow('sunroofclose');}
    // 打开遮阳帘函数
    async sunshadeopen() {await this.controlWindow('sunshadeopen');}
    // 关闭遮阳帘函数
    async sunshadeclose() {await this.controlWindow('sunshadeclose');}

    //空气净化控制通用函数
    async controlPurifier(action) {
        try {
            // 根据动作设置参数
            const params = {
                'purifieropen': { type: 1, name: '打开' },
                'purifierclose': { type: 2, name: '关闭' }
            }[action];

            if (!params) {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 无效的净化控制命令！`);
                return;
            }

            // 准备请求体
            const body = {
                "clientType": 2,
                "conditioner": null,
                "dayOfWeek": null,
                "duration": null,
                "endTimeOfDay": null,
                "heat": null,
                "level": null,
                "password": null,
                "platform": "2.0",
                "scheduledTime": null,
                "startTimeOfDay": null,
                "target": null,
                "temp": null,
                "timerId": null,
                "type": params.type,
                "udId": null,
                "ventilation": 99,
                "vin": this.vehicleInfo.vin
            };

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/noEngine`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/noEngine`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行净化控制请求
            let result = await httpRequest(options);

            if (result.code == 0) {
                $.DoubleLog(`✅${params.name}净化成功！`);
                Notify = 1;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} ${params.name}净化失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    // 打开净化函数
    async purifieropen() {await this.controlPurifier('purifieropen');}
    // 关闭净化函数
    async purifierclose() {await this.controlPurifier('purifierclose');}

    //空调控制通用函数（包括除霜和空调）
    async controlClimate(action, temperature = 25) {
        try {
            // 根据动作设置参数
            const params = {
                'defrostopen': { type: 1, conditioner: 2, name: '打开除霜' },
                'defrostclose': { type: 2, conditioner: 2, name: '关闭除霜' },
                'aconopen': { type: 1, conditioner: 1, name: '打开空调' },
                'aconclose': { type: 2, conditioner: 1, name: '关闭空调' }
            }[action];

            if (!params) {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 无效的空调控制命令！`);
                return;
            }

            // 准备请求体
            const body = {
                "clientType": 2,
                "conditioner": params.conditioner,
                "dayOfWeek": null,
                "duration": 90,
                "endTimeOfDay": null,
                "heat": null,
                "heatLevel": null,
                "password": null,
                "platform": "2.0",
                "scheduledTime": null,
                "startTimeOfDay": null,
                "temp": temperature.toString(),
                "timerId": null,
                "type": params.type,
                "udId": null,
                "ventilation": null,
                "ventilationLevel": null,
                "vin": this.vehicleInfo.vin
            };

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/climate`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/climate`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行空调控制请求
            let result = await httpRequest(options);

            if (result.code == 0) {
                $.DoubleLog(`✅${params.name}成功！${action === 'aconopen' ? `温度设置为${temperature}°C` : ''}`);
                if (action === 'aconopen') {
                    this.acTemp = temperature;  // 保存设置的温度
                }
                Notify = 1;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} ${params.name}失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    // 打开空调函数
    async aconopen(temperature = null) {
        await this.controlClimate('aconopen', temperature || this.acTemp || 25);
    }

    // 关闭空调函数
    async aconclose() {
        await this.controlClimate('aconclose');
    }

    // 打开除霜函数
    async defrostopen() {
        await this.controlClimate('defrostopen');
    }

    // 关闭除霜函数
    async defrostclose() {
        await this.controlClimate('defrostclose');
    }

    //温度控制通用函数
    async controlTemperature(action) {
        try {
            // 根据动作设置参数
            const params = {
                'rapidheat': { 
                    type: 3,
                    temp: 28.5,
                    heat: [1, 2],
                    heatValue: 3,
                    ventilation: null,
                    ventilationValue: null,
                    name: '极速升温'
                },
                'rapidcool': { 
                    type: 3,
                    temp: 15.5,
                    heat: null,
                    heatValue: null,
                    ventilation: [1, 2],
                    ventilationValue: 3,
                    name: '极速降温'
                }
            }[action];

            if (!params) {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 无效的温度控制命令！`);
                return;
            }

            // 准备请求体
            const body = {
                "clientType": 2,
                "dayOfWeek": null,
                "duration": 90,
                "paa": 0,
                "paaAc": true,
                "paaAcTemp": params.temp,
                "paaHeat": params.heat,
                "paaHeatValue": params.heatValue,
                "paaSw": null,
                "paaVentilation": params.ventilation,
                "paaVentilationValue": params.ventilationValue,
                "paaVlt": params.ventilation !== null,
                "paaVltDuration": 60,
                "paaVltPos": null,
                "password": null,
                "platform": "2.0",
                "scheduledTime": Date.now(),
                "startTimeOfDay": null,
                "timerActivation": null,
                "timerId": null,
                "type": params.type,
                "udId": null,
                "vin": this.vehicleInfo.vin
            };

            // 使用getPostHeader生成请求头
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/vehicle/control/temperature`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/vehicle/control/temperature`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行温度控制请求
            let result = await httpRequest(options);

            if (result.code == 0) {
                $.DoubleLog(`✅${params.name}成功！`);
                Notify = 1;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} ${params.name}失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            console.log(e);
        }
    }

    // 极速升温函数
    async rapidheat() {
        await this.controlTemperature('rapidheat');
    }

    // 极速降温函数
    async rapidcool() {
        await this.controlTemperature('rapidcool');
    }

    // 获取驻车图片函数
    async photo() {
        try {
            // 准备请求体
            const body = {
                "clientType": 2,
                "udid": null,
                "vin": this.vehicleInfo.vin
            };

            // 使用getPostHeader生成请求头，注意这里使用的是vc域名的key
            let options = {
                url: `https://galaxy-vc.geely.com/vc/app/v1/sentinel/queryPhotoList`,
                headers: this.getPostHeader(204373120, `/vc/app/v1/sentinel/queryPhotoList`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };

            // 执行查询图片列表请求
            let result = await httpRequest(options);

            if (result.code == 0 && result.data && result.data.photos && result.data.photos.length > 0) {
                $.DoubleLog(`✅ ${getFormattedTimestamp()} 获取到${result.data.photos.length}张驻车图片`);
                $.DoubleLog(`📸 拍摄时间: ${result.data.displayTime}`);

                // 创建保存图片的目录
                const fs = require('fs');
                const path = require('path');
                const https = require('https');
                const http = require('http');

                // 使用车架号创建目录
                const photoDir = path.join(__dirname, 'parking_photos', this.vehicleInfo.vin);
                if (!fs.existsSync(photoDir)) {
                    fs.mkdirSync(photoDir, { recursive: true });
                    $.DoubleLog(`📁 创建图片保存目录: ${photoDir}`);
                }

                // 下载每张图片
                let downloadCount = 0;
                let skipCount = 0;

                for (const photo of result.data.photos) {
                    if (photo.status === '0' && photo.url) {
                        const fileName = photo.name;
                        const filePath = path.join(photoDir, fileName);

                        // 检查文件是否已存在
                        if (fs.existsSync(filePath)) {
                            $.DoubleLog(`⏭️  图片已存在，跳过: ${fileName}`);
                            skipCount++;
                            continue;
                        }

                        // 下载图片
                        try {
                            await this.downloadPhoto(photo.url, filePath);
                            $.DoubleLog(`✅ 下载成功: ${fileName}`);
                            downloadCount++;
                        } catch (e) {
                            $.DoubleLog(`❌ ${getFormattedTimestamp()} 下载失败 ${fileName}: ${e.message}`);
                        }
                    }
                }

                $.DoubleLog(`📊 下载完成! 新下载: ${downloadCount}张, 跳过: ${skipCount}张`);
                $.DoubleLog(`💾 保存位置: ${photoDir}`);
            } else if (result.code == 0 && result.data && result.data.photos && result.data.photos.length === 0) {
                $.DoubleLog(`ℹ️ ${getFormattedTimestamp()} 当前没有驻车图片`);
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取驻车图片失败！`);
                console.log("⚠️失败原因:", result);
                Notify = 1;
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取驻车图片异常: ${e.message}`);
            console.log(e);
        }
    }

    // 下载图片的辅助函数
    downloadPhoto(url, filePath) {
        return new Promise((resolve, reject) => {
            const fs = require('fs');
            const https = require('https');
            const http = require('http');

            const protocol = url.startsWith('https') ? https : http;
            const file = fs.createWriteStream(filePath);

            protocol.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    resolve();
                });

                file.on('error', (err) => {
                    fs.unlink(filePath, () => {});
                    reject(err);
                });
            }).on('error', (err) => {
                fs.unlink(filePath, () => {});
                reject(err);
            });
        });
    }

    // *********************************************************
    // 充电桩管理类函数

    // 对URL path中的query参数按字母序排列（阿里云API网关签名要求）
    sortQueryParams(path) {
        const idx = path.indexOf('?');
        if (idx === -1) return path;
        const basePath = path.substring(0, idx);
        const query = path.substring(idx + 1);
        const sorted = query.split('&').sort().join('&');
        return `${basePath}?${sorted}`;
    }

    // 获取充电模块授权码
    async getRechargeAuthCode() {
        try {
            const urlPath = `/api/v1/oauth2/code?scope=snsapiUserinfo&response_type=code&isDestruction=false&state=1&client_id=30000023`;
            // 签名时query参数需要按字母序排列
            const signPath = this.sortQueryParams(urlPath);
            const key = 204179735;

            let currentDate = new Date();
            let formattedDate = this.formatDate(currentDate, 0);
            let parts = formattedDate.split(" ");
            formattedDate = `${parts[0]}, ${parts[2]} ${parts[1]} ${parts[3]} ${parts[4]} GMT`;
            let timestamp = new Date(formattedDate).getTime();
            let uuid = this.generateUUID();

            // appcode参与签名
            let signature = this.calculateHmacSha256("GET", "application/json; charset=utf-8", "", "application/x-www-form-urlencoded; charset=utf-8", formattedDate, key, uuid, timestamp, signPath, 'galaxy-app-user');

            // 复用getGetHeader的基础headers结构
            let headers = this.getGetHeader(key, urlPath);
            // 覆盖签名相关字段
            headers['date'] = formattedDate;
            headers['x-ca-signature'] = signature;
            headers['x-ca-appcode'] = 'galaxy-app-user';
            headers['x-ca-nonce'] = uuid;
            headers['x-ca-timestamp'] = timestamp;
            headers['x-ca-signature-headers'] = 'x-ca-appcode,x-ca-nonce,x-ca-key,x-ca-timestamp';

            let options = {
                url: `https://galaxy-user-api.geely.com${urlPath}`,
                headers: headers,
            };
            let result = await httpRequest(options);
            if (result && result.code == 'success' && result.data && result.data.code) {
                return result.data.code;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取充电授权码失败: ${JSON.stringify(result)}`);
                return null;
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取充电授权码异常: ${e.message}`);
            return null;
        }
    }

    // 用授权码换取充电模块token
    async getRechargeToken() {
        try {
            const code = await this.getRechargeAuthCode();
            if (!code) return false;

            let options = {
                url: `https://api-recharge.geely.com/login/auth-token?code=${code}`,
                headers: this.getGetHeader(204195485, `/login/auth-token?code=${code}`),
            };
            let result = await httpRequest(options);
            if (result.code == 1 && result.data && result.data.length > 0) {
                this.rechargeToken = result.data[0].authToken;
                this.rechargeRefreshToken = result.data[0].authRefreshToken;
                // token有效期约1799秒(30分钟)，提前60秒刷新
                this.rechargeTokenExpiry = Date.now() + (parseInt(result.data[0].expireAt) - 60) * 1000;
                $.DoubleLog(`✅ ${getFormattedTimestamp()} 充电模块认证成功`);
                return true;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 充电模块认证失败: ${JSON.stringify(result)}`);
                return false;
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 充电模块认证异常: ${e.message}`);
            return false;
        }
    }

    // 确保充电模块已认证（每次状态更新周期都刷新）
    async ensureRechargeAuth() {
        if (!this.rechargeToken) {
            return await this.getRechargeToken();
        }
        return true;
    }

    // 刷新充电模块token（在定时更新中调用）
    async refreshRechargeToken() {
        this.rechargeToken = '';
        return await this.getRechargeToken();
    }

    // 获取充电桩列表
    async getMyPilings() {
        try {
            if (!await this.ensureRechargeAuth()) return [];

            if (!this.rechargeUserId) {
                await this.getRechargeUserInfo();
            }
            const body = { "userId": this.rechargeUserId };
            let options = {
                url: `https://api-recharge.geely.com/app/hcharger/getMyPilingsNew`,
                headers: this.getPostHeader(204195485, `/app/hcharger/getMyPilingsNew`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };
            let result = await httpRequest(options);
            if (result.code == 1 && result.data) {
                const isFirstLoad = this.chargingPiles.length === 0;
                this.chargingPiles = result.data;
                if (isFirstLoad || showInfoLogs) {
                    $.DoubleLog(`✅ ${getFormattedTimestamp()} 获取充电桩列表成功，共${result.data.length}个桩`);
                    for (const pile of result.data) {
                        const statusText = pile.status === 0 ? '空闲' : pile.status === 1 ? '已连接' : pile.status === 2 ? '充电中' : pile.status === 4 ? '等待充电' : `状态${pile.status}`;
                        $.DoubleLog(`  🔌 ${pile.name || pile.pilingsCode}: ${statusText} ${pile.isOnline === 1 ? '(在线)' : '(离线)'}`);
                    }
                }
                return result.data;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取充电桩列表失败: ${JSON.stringify(result)}`);
                return [];
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取充电桩列表异常: ${e.message}`);
            return [];
        }
    }

    // 获取充电桩详情
    async getPilingDetail(pilingsCode) {
        try {
            if (!await this.ensureRechargeAuth()) return null;

            const body = { "pilingsCode": pilingsCode };
            let options = {
                url: `https://api-recharge.geely.com/app/hcharger/getPlingsDetailNew`,
                headers: this.getPostHeader(204195485, `/app/hcharger/getPlingsDetailNew`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };
            let result = await httpRequest(options);
            if (result.code == 1 && result.data && result.data.length > 0) {
                return result.data[0];
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取充电桩详情失败: ${JSON.stringify(result)}`);
                return null;
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取充电桩详情异常: ${e.message}`);
            return null;
        }
    }

    // 充电预检
    async chargePreCheck(pilingsCode, type = "0") {
        try {
            if (!await this.ensureRechargeAuth()) return { ok: false, reqId: '' };

            const body = { "type": type, "pilingsCode": pilingsCode };
            let options = {
                url: `https://api-recharge.geely.com/app/hcharger/chargePreCheck`,
                headers: this.getPostHeader(204195485, `/app/hcharger/chargePreCheck`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };
            let result = await httpRequest(options);
            const actionText = type === "0" ? '启动' : '停止';
            if (result.code == 1 && result.model) {
                if (result.model.code === "0") {
                    $.DoubleLog(`✅ ${getFormattedTimestamp()} 充电预检通过 (${actionText}) ${result.model.msg || ''}`);
                    return { ok: true, reqId: result.model.reqId || '' };
                } else {
                    $.DoubleLog(`❌ ${getFormattedTimestamp()} 充电预检不通过 (${actionText}): ${result.model.msg || '未知原因'} [code:${result.model.code}]`);
                    return { ok: false, reqId: '' };
                }
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 充电预检失败: ${result.message || JSON.stringify(result)}`);
                return { ok: false, reqId: '' };
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 充电预检异常: ${e.message}`);
            return { ok: false, reqId: '' };
        }
    }

    // 启动/停止充电 type: "0"=启动, "1"=停止
    async doCharge(pilingsCode, type = "0") {
        try {
            if (!await this.ensureRechargeAuth()) return false;

            // 先预检
            const preCheck = await this.chargePreCheck(pilingsCode, type);
            if (!preCheck.ok) return false;

            const body = { "type": type, "pilingsCode": pilingsCode, "reqId": preCheck.reqId };
            let options = {
                url: `https://api-recharge.geely.com/app/hcharger/startCharge`,
                headers: this.getPostHeader(204195485, `/app/hcharger/startCharge`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };
            let result = await httpRequest(options);
            const actionText = type === "0" ? '启动充电' : '停止充电';
            if (result.code == 1) {
                if (result.model) {
                    $.DoubleLog(`✅ ${getFormattedTimestamp()} ${actionText}成功！桩号: ${pilingsCode} 序列号: ${result.model.startChargeSeq || '-'}`);
                } else {
                    $.DoubleLog(`✅ ${getFormattedTimestamp()} ${actionText}成功！桩号: ${pilingsCode}`);
                }
                Notify = 1;
                return true;
            } else {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} ${actionText}失败: ${result.message || JSON.stringify(result)}`);
                return false;
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 充电操作异常: ${e.message}`);
            return false;
        }
    }

    // 获取充电实时数据
    async getChargingData(equipmentId) {
        try {
            if (!await this.ensureRechargeAuth()) return null;

            const body = { "equipmentId": equipmentId };
            let options = {
                url: `https://api-recharge.geely.com/app/hcharger/getChargingData`,
                headers: this.getPostHeader(204195485, `/app/hcharger/getChargingData`, JSON.stringify(body)),
                body: JSON.stringify(body)
            };
            let result = await httpRequest(options);
            if (result.code == 1 && result.model) {
                return result.model;
            } else {
                return null;
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取充电数据异常: ${e.message}`);
            return null;
        }
    }

    // 获取充电桩pilingsCode，支持指定ID或默认第一个
    async resolvePileCode(pileId) {
        if (this.chargingPiles.length === 0) {
            await this.getMyPilings();
        }
        if (this.chargingPiles.length === 0) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 没有找到充电桩`);
            return null;
        }
        if (pileId) {
            const found = this.chargingPiles.find(p => p.pilingsCode === pileId);
            if (found) return found.pilingsCode;
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 未找到充电桩: ${pileId}`);
            return null;
        }
        return this.chargingPiles[0].pilingsCode;
    }

    // 启动充电（命令行/MQTT入口）
    async startcharge(pileId) {
        await this.refresh_token();
        const code = await this.resolvePileCode(pileId);
        if (!code) return;
        await this.doCharge(code, "0");
    }

    // 停止充电（命令行/MQTT入口）
    async stopcharge(pileId) {
        await this.refresh_token();
        const code = await this.resolvePileCode(pileId);
        if (!code) return;
        await this.doCharge(code, "1");
    }

    // 获取充电模块用户ID
    async getRechargeUserInfo() {
        try {
            if (!await this.ensureRechargeAuth()) return;

            let options = {
                url: `https://api-recharge.geely.com/login/userinfo`,
                headers: this.getGetHeader(204195485, `/login/userinfo`),
            };
            let result = await httpRequest(options);
            if (result.code == 1 && result.data && result.data.length > 0) {
                this.rechargeUserId = result.data[0].userId;
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取充电用户信息异常: ${e.message}`);
        }
    }

    // 判断是否显示信息获取日志的函数 (已废弃,由main函数直接处理)
    shouldShowInfoLogs(features) {
        return false;
    }

    // MQTT消息发送函数
    async sendMqttMessage(topic, message) {
        try {
            if (!this.mqttClient) {
                await this.initMqtt();
            }

            return new Promise((resolve, reject) => {
                this.mqttClient.publish(topic, JSON.stringify(message), (err) => {
                    if (err) {
                        $.DoubleLog(`❌ ${getFormattedTimestamp()} MQTT消息发送失败: ${err.message}`);
                        reject(err);
                    } else {
                        //$.DoubleLog(`✅MQTT消息发送成功: ${topic}`);
                        resolve();
                    }
                });
            });
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} MQTT错误: ${e.message}`);
            console.log(e);
        }
    }

    // 发送车辆状态到MQTT
    async sendVehicleStatusMqtt() {
        // 如果MQTT未启用，直接返回
        if (!defaultEnableMqtt && !process.argv.slice(2).includes('mqtt')) {
            return;
        }
        try {
            if (!this.vehicleStatus) {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 没有车辆状态数据可发送`);
                return;
            }

            // 准备传感器数据
            const sensorData = {
                temperature: this.vehicleStatus.vehicleEnvironmentStatus?.interiorTemp,
                exterior_temperature: this.vehicleStatus.vehicleEnvironmentStatus?.exteriorTemp,
                battery: this.vehicleStatus.vehicleBatteryStatus?.chargeLevel,
                pm25: this.vehicleStatus.vehicleEnvironmentStatus?.interiorPM25Level,
                mileage: Math.round(this.vehicleStatus.basicVehicleStatus?.odometer),
                range: this.vehicleStatus.basicVehicleStatus?.distanceToEmptyOnBatteryOnly,
                longitude: parseFloat((this.vehicleStatus.vehicleLocationStatus?.longitude / 3600000).toFixed(6)),
                latitude: parseFloat((this.vehicleStatus.vehicleLocationStatus?.latitude / 3600000).toFixed(6)),
                charging_time: this.vehicleStatus.vehicleBatteryStatus?.timeToFullyCharged === '2047' ? 0 : parseFloat((this.vehicleStatus.vehicleBatteryStatus?.timeToFullyCharged / 60).toFixed(1)),
                // 使用统一的状态检测方法
                sentry_mode: this.checkStatus('sentry'),
                door_state: this.checkStatus('door'),
                ac_state: this.checkStatus('ac'),
                defrost_state: this.checkStatus('defrost'),
                purifier_state: this.checkStatus('purifier'),
                sunroof_state: this.checkStatus('sunroof'),
                sunshade_state: this.checkStatus('sunshade'),
                ac_temp: this.acTemp || 25,  // 添加空调温度状态
                
                // 添加新的状态字段
                usage_mode: this.vehicleStatus.basicVehicleStatus?.usageMode,
                current_speed: this.vehicleStatus.vehicleRunningStatus?.speed,
                e_brake_status: this.vehicleStatus.vehicleRunningStatus?.electricParkBrakeStatus,
                gear_status: this.vehicleStatus.vehicleRunningStatus?.gearAutoStatus,
                trip_power_consumption: this.vehicleStatus.vehicleRunningStatus?.averTraPowerConsumption,
                avg_power_consumption: this.vehicleStatus.vehicleRunningStatus?.averPowerConsumption,
                
                // 添加电机状态和后备箱锁状态
                engine_status: this.vehicleStatus.vehicleEngineStatus?.engineStatus,
                trunk_lock_status: this.vehicleStatus.vehicleDoorCoverStatus?.trunkLockStatus,
                // 最新SOC目标电量
                target_soc: this.lastSoc || null
            };

            // 保存最后的传感器数据用于后续更新
            this.lastSensorData = sensorData;

            // 发送状态数据
            const stateTopic = `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`;
            await this.sendMqttMessage(stateTopic, sensorData);

            // 发送位置数据
            const locationData = {
                latitude: sensorData.latitude,
                longitude: sensorData.longitude,
                gps_accuracy: 100,
                battery_level: sensorData.battery
            };
            const locationTopic = `homeassistant/device_tracker/geely_${this.vehicleInfo.vin}/state`;
            // 直接发送对象，不要再次使用 JSON.stringify
            await this.sendMqttMessage(locationTopic, locationData);

            // 设备追踪器配置
            const deviceTrackerConfig = {
                name: "车辆位置",
                unique_id: `geely_${this.vehicleInfo.vin}_tracker`,
                state_topic: `homeassistant/device_tracker/geely_${this.vehicleInfo.vin}/state`,
                json_attributes_topic: `homeassistant/device_tracker/geely_${this.vehicleInfo.vin}/state`,
                payload_home: "home",
                payload_not_home: "not_home",
                source_type: "gps",
                icon: "mdi:car",
                device: {
                    identifiers: [`geely_${this.vehicleInfo.vin}`],
                    name: "吉利银河",
                    model: this.vehicleInfo.seriesNameVs,
                    manufacturer: "Geely"
                }
            };

            // 发送设备追踪器配置时，确保 payload 是 JSON 格式
            const trackerConfigTopic = `homeassistant/device_tracker/geely_${this.vehicleInfo.vin}/config`;
            await this.sendMqttMessage(trackerConfigTopic, deviceTrackerConfig);

            // 添加传感器配置
            const sensorConfigs = {
                temperature: {
                    name: "车内温度",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.temperature }}",
                    unit_of_measurement: "°C",
                    unique_id: `geely_${this.vehicleInfo.vin}_temperature`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`],
                        name: "吉利银河",
                        model: this.vehicleInfo.seriesNameVs,
                        manufacturer: "Geely"
                    }
                },
                exterior_temperature: {
                    name: "车外温度",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.exterior_temperature }}",
                    unit_of_measurement: "°C",
                    unique_id: `geely_${this.vehicleInfo.vin}_exterior_temperature`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                battery: {
                    name: "电池电量",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.battery }}",
                    unit_of_measurement: "%",
                    unique_id: `geely_${this.vehicleInfo.vin}_battery`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                pm25: {
                    name: "车内PM2.5",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.pm25 }}",
                    unit_of_measurement: "μg/m³",
                    unique_id: `geely_${this.vehicleInfo.vin}_pm25`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                mileage: {
                    name: "总里程",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.mileage }}",
                    unit_of_measurement: "km",
                    unique_id: `geely_${this.vehicleInfo.vin}_mileage`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                range: {
                    name: "续航里程",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.range }}",
                    unit_of_measurement: "km",
                    unique_id: `geely_${this.vehicleInfo.vin}_range`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                charging_time: {
                    name: "充满时间",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.charging_time }}",
                    unit_of_measurement: "h",
                    unique_id: `geely_${this.vehicleInfo.vin}_charging_time`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                location: {
                    name: "车辆位置",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.latitude }},{{ value_json.longitude }}",
                    unique_id: `geely_${this.vehicleInfo.vin}_location`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                // 添加新的传感器配置
                usage_mode: {
                    name: "使用模式",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.usage_mode }}",
                    unique_id: `geely_${this.vehicleInfo.vin}_usage_mode`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                current_speed: {
                    name: "当前车速",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.current_speed }}",
                    unit_of_measurement: "km/h",
                    unique_id: `geely_${this.vehicleInfo.vin}_current_speed`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                e_brake_status: {
                    name: "电子手刹状态",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.e_brake_status }}",
                    unique_id: `geely_${this.vehicleInfo.vin}_e_brake_status`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                gear_status: {
                    name: "挡位状态",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.gear_status }}",
                    unique_id: `geely_${this.vehicleInfo.vin}_gear_status`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                trip_power_consumption: {
                    name: "行程平均能耗",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.trip_power_consumption }}",
                    unit_of_measurement: "kWh/100km",
                    unique_id: `geely_${this.vehicleInfo.vin}_trip_power_consumption`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                avg_power_consumption: {
                    name: "近期平均能耗",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.avg_power_consumption }}",
                    unit_of_measurement: "kWh/100km",
                    unique_id: `geely_${this.vehicleInfo.vin}_avg_power_consumption`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                engine_status: {
                    name: "电机状态",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.engine_status }}",
                    unique_id: `geely_${this.vehicleInfo.vin}_engine_status`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                trunk_lock_status: {
                    name: "后备箱锁状态",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.trunk_lock_status }}",
                    unique_id: `geely_${this.vehicleInfo.vin}_trunk_lock_status`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                target_soc: {
                    name: "目标SOC",
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.target_soc }}",
                    unit_of_measurement: "%",
                    icon: "mdi:battery-charging-high",
                    unique_id: `geely_${this.vehicleInfo.vin}_target_soc`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                }
            };

            // 发送传感器配置
            for (const [sensorName, config] of Object.entries(sensorConfigs)) {
                const configTopic = `homeassistant/sensor/geely_${this.vehicleInfo.vin}/${sensorName}/config`;
                await this.sendMqttMessage(configTopic, config);
            }

            // 添加空调温度滑动条配置
            const climateConfigs = {
                ac_temp: {
                    name: "空调温度",
                    command_topic: `homeassistant/number/geely_${this.vehicleInfo.vin}/ac_temp/set`,
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.ac_temp }}",
                    min: 16,
                    max: 32,
                    step: 0.5,
                    unit_of_measurement: "°C",
                    unique_id: `geely_${this.vehicleInfo.vin}_ac_temp`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`],
                        name: "吉利银河",
                        model: this.vehicleInfo.seriesNameVs,
                        manufacturer: "Geely"
                    }
                }
            };

            // 发送空调温度滑动条配置
            for (const [name, config] of Object.entries(climateConfigs)) {
                const configTopic = `homeassistant/number/geely_${this.vehicleInfo.vin}/${name}/config`;
                await this.sendMqttMessage(configTopic, config);
            }

            // 添加开关配置
            const switchConfigs = {
                sentry: {
                    name: "哨兵模式",
                    command_topic: `homeassistant/switch/geely_${this.vehicleInfo.vin}/sentry/set`,
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.sentry_mode }}",
                    payload_on: "ON",
                    payload_off: "OFF",
                    state_on: "ON",
                    state_off: "OFF",
                    unique_id: `geely_${this.vehicleInfo.vin}_sentry`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`],
                        name: "吉利银河",
                        model: this.vehicleInfo.seriesNameVs,
                        manufacturer: "Geely"
                    }
                },
                door: {
                    name: "车门锁",
                    command_topic: `homeassistant/switch/geely_${this.vehicleInfo.vin}/door/set`,
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.door_state }}",
                    payload_on: "ON",
                    payload_off: "OFF",
                    state_on: "ON",
                    state_off: "OFF",
                    unique_id: `geely_${this.vehicleInfo.vin}_door`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                ac: {
                    name: "空调",
                    command_topic: `homeassistant/switch/geely_${this.vehicleInfo.vin}/ac/set`,
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.ac_state }}",
                    payload_on: "ON",
                    payload_off: "OFF",
                    state_on: "ON",
                    state_off: "OFF",
                    unique_id: `geely_${this.vehicleInfo.vin}_ac`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                defrost: {
                    name: "除霜",
                    command_topic: `homeassistant/switch/geely_${this.vehicleInfo.vin}/defrost/set`,
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.defrost_state }}",
                    payload_on: "ON",
                    payload_off: "OFF",
                    state_on: "ON",
                    state_off: "OFF",
                    unique_id: `geely_${this.vehicleInfo.vin}_defrost`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                purifier: {
                    name: "空气净化",
                    command_topic: `homeassistant/switch/geely_${this.vehicleInfo.vin}/purifier/set`,
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.purifier_state }}",
                    payload_on: "ON",
                    payload_off: "OFF",
                    state_on: "ON",
                    state_off: "OFF",
                    unique_id: `geely_${this.vehicleInfo.vin}_purifier`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                sunroof: {
                    name: "天窗",
                    command_topic: `homeassistant/switch/geely_${this.vehicleInfo.vin}/sunroof/set`,
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.sunroof_state }}",
                    payload_on: "ON",
                    payload_off: "OFF",
                    state_on: "ON",
                    state_off: "OFF",
                    unique_id: `geely_${this.vehicleInfo.vin}_sunroof`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                sunshade: {
                    name: "遮阳帘",
                    command_topic: `homeassistant/switch/geely_${this.vehicleInfo.vin}/sunshade/set`,
                    state_topic: `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`,
                    value_template: "{{ value_json.sunshade_state }}",
                    payload_on: "ON",
                    payload_off: "OFF",
                    state_on: "ON",
                    state_off: "OFF",
                    unique_id: `geely_${this.vehicleInfo.vin}_sunshade`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                }
            };

            // 发送开关配置
            for (const [switchName, config] of Object.entries(switchConfigs)) {
                const configTopic = `homeassistant/switch/geely_${this.vehicleInfo.vin}/${switchName}/config`;
                await this.sendMqttMessage(configTopic, config);
                
            }

            // 添加按钮配置
            const buttonConfigs = {
                rapidheat: {
                    name: "极速升温",
                    command_topic: `homeassistant/button/geely_${this.vehicleInfo.vin}/rapidheat/press`,
                    unique_id: `geely_${this.vehicleInfo.vin}_rapidheat`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`],
                        name: "吉利银河",
                        model: this.vehicleInfo.seriesNameVs,
                        manufacturer: "Geely"
                    }
                },
                rapidcool: {
                    name: "极速降温",
                    command_topic: `homeassistant/button/geely_${this.vehicleInfo.vin}/rapidcool/press`,
                    unique_id: `geely_${this.vehicleInfo.vin}_rapidcool`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                search: {
                    name: "闪灯鸣笛",
                    command_topic: `homeassistant/button/geely_${this.vehicleInfo.vin}/search/press`,
                    unique_id: `geely_${this.vehicleInfo.vin}_search`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                windowslightopen: {
                    name: "微开车窗",
                    command_topic: `homeassistant/button/geely_${this.vehicleInfo.vin}/windowslightopen/press`,
                    unique_id: `geely_${this.vehicleInfo.vin}_windowslightopen`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                windowfullopen: {
                    name: "全开车窗",
                    command_topic: `homeassistant/button/geely_${this.vehicleInfo.vin}/windowfullopen/press`,
                    unique_id: `geely_${this.vehicleInfo.vin}_windowfullopen`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                },
                windowclose: {
                    name: "关闭车窗",
                    command_topic: `homeassistant/button/geely_${this.vehicleInfo.vin}/windowclose/press`,
                    unique_id: `geely_${this.vehicleInfo.vin}_windowclose`,
                    device: {
                        identifiers: [`geely_${this.vehicleInfo.vin}`]
                    }
                }
            };

            // 发送按钮配置
            for (const [buttonName, config] of Object.entries(buttonConfigs)) {
                const configTopic = `homeassistant/button/geely_${this.vehicleInfo.vin}/${buttonName}/config`;
                await this.sendMqttMessage(configTopic, config);
            }

            // 发送充电桩状态到MQTT
            await this.sendChargingPileStatusMqtt();

            // 删除成功日志，将由updateAndSendStatus统一输出
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 发送车辆状态到MQTT失败: ${e.message}`);
            console.log(e);
        }
    }

    // 发送充电桩状态到MQTT
    async sendChargingPileStatusMqtt() {
        try {
            // 获取充电桩列表（内部会自动认证和获取userId）
            const piles = await this.getMyPilings();
            if (!piles || piles.length === 0) return;

            for (const pile of piles) {
                const pileCode = pile.pilingsCode;
                const detail = await this.getPilingDetail(pileCode);
                if (!detail) continue;

                // 获取充电实时数据（仅充电中时有意义）
                let chargingData = null;
                if (detail.status === 2) {
                    chargingData = await this.getChargingData(pileCode);
                }

                const statusMap = { 0: '空闲', 1: '已连接', 2: '充电中', 3: '故障', 4: '等待充电' };
                const isCharging = detail.status === 2;

                // 充电桩状态数据
                const pileStateData = {
                    status: statusMap[detail.status] || `未知(${detail.status})`,
                    status_code: detail.status,
                    is_online: detail.isOnline === 1 ? 'ON' : 'OFF',
                    is_charging: isCharging ? 'ON' : 'OFF',
                    voltage: chargingData ? chargingData.voltageA : 0,
                    current: chargingData ? chargingData.currentA : 0,
                    power: chargingData ? parseFloat((chargingData.voltageA * chargingData.currentA / 1000).toFixed(2)) : 0,
                    total_kwh: chargingData ? chargingData.lastChargeTotalPower : 0,
                    charge_hours: chargingData ? chargingData.lastChargeHours : 0,
                    pile_name: detail.name || pileCode
                };

                // 发送状态
                const stateTopic = `homeassistant/sensor/geely_pile_${pileCode}/state`;
                await this.sendMqttMessage(stateTopic, pileStateData);

                // 传感器配置
                const pileSensorConfigs = {
                    status: {
                        name: `充电桩状态`,
                        value_template: "{{ value_json.status }}",
                        icon: "mdi:ev-station",
                    },
                    voltage: {
                        name: `充电电压`,
                        value_template: "{{ value_json.voltage }}",
                        unit_of_measurement: "V",
                        icon: "mdi:flash",
                    },
                    current: {
                        name: `充电电流`,
                        value_template: "{{ value_json.current }}",
                        unit_of_measurement: "A",
                        icon: "mdi:current-ac",
                    },
                    power: {
                        name: `充电功率`,
                        value_template: "{{ value_json.power }}",
                        unit_of_measurement: "kW",
                        icon: "mdi:lightning-bolt",
                    },
                    total_kwh: {
                        name: `本次充电量`,
                        value_template: "{{ value_json.total_kwh }}",
                        unit_of_measurement: "kWh",
                        icon: "mdi:battery-charging",
                    },
                    charge_hours: {
                        name: `充电时长`,
                        value_template: "{{ value_json.charge_hours }}",
                        unit_of_measurement: "h",
                        icon: "mdi:timer",
                    }
                };

                const device = {
                    identifiers: [`geely_pile_${pileCode}`],
                    name: `充电桩 ${detail.name || pileCode}`,
                    model: pileCode,
                    manufacturer: "Geely"
                };

                // 发送传感器配置
                for (const [sensorName, config] of Object.entries(pileSensorConfigs)) {
                    const configTopic = `homeassistant/sensor/geely_pile_${pileCode}/${sensorName}/config`;
                    await this.sendMqttMessage(configTopic, {
                        ...config,
                        state_topic: stateTopic,
                        unique_id: `geely_pile_${pileCode}_${sensorName}`,
                        device: sensorName === 'status' ? device : { identifiers: [`geely_pile_${pileCode}`] }
                    });
                }

                // 充电开关配置
                const switchConfigTopic = `homeassistant/switch/geely_pile_${pileCode}/charging/config`;
                await this.sendMqttMessage(switchConfigTopic, {
                    name: `充电开关`,
                    command_topic: `homeassistant/switch/geely_pile_${pileCode}/charging/set`,
                    state_topic: stateTopic,
                    value_template: "{{ value_json.is_charging }}",
                    payload_on: "ON",
                    payload_off: "OFF",
                    state_on: "ON",
                    state_off: "OFF",
                    icon: "mdi:ev-plug-type2",
                    unique_id: `geely_pile_${pileCode}_charging`,
                    device: { identifiers: [`geely_pile_${pileCode}`] }
                });
            }
        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 发送充电桩状态到MQTT失败: ${e.message}`);
            console.log(e);
        }
    }

    // 初始化MQTT连接
    async initMqtt() {
        try {
            if (this.mqttClient) {
                // 如果已经有连接，先断开旧连接
                this.mqttClient.end(true);
                await new Promise(resolve => setTimeout(resolve, 1000));
                this.mqttClient = null;
                $.DoubleLog(`🔄断开旧MQTT连接，准备重新连接`);
            }

            const mqtt = require('mqtt');
            
            // 添加基础的重连配置
            const connectConfig = {
                port: mqttConfig.port,
                username: mqttConfig.username,
                password: mqttConfig.password,
                clientId: mqttConfig.clientId, // 固定使用配置中的客户端ID
                reconnectPeriod: 5000,   // 重连间隔5秒
                clean: true,             // 清除会话
                connectTimeout: 10000,   // 连接超时时间
                rejectUnauthorized: false // 不验证服务器证书
            };

            // 输出连接信息
            $.DoubleLog(`🔄正在连接MQTT服务器: ${mqttConfig.host}:${mqttConfig.port}`);
            $.DoubleLog(`🔑使用客户端ID: ${mqttConfig.clientId}`);

            this.mqttClient = mqtt.connect(mqttConfig.host, connectConfig);

            // 连接成功事件
            this.mqttClient.on('connect', async () => {
                $.DoubleLog(`✅MQTT连接成功`);
                
                // 订阅主题
                const topics = [
                    `homeassistant/switch/geely_${this.vehicleInfo.vin}/+/set`,
                    `homeassistant/button/geely_${this.vehicleInfo.vin}/+/press`,
                    `homeassistant/number/geely_${this.vehicleInfo.vin}/ac_temp/set`,
                    `homeassistant/switch/+/charging/set`
                ];
                
                topics.forEach(topic => {
                    this.mqttClient.subscribe(topic, (err) => {
                        if (err) {
                            $.DoubleLog(`❌ ${getFormattedTimestamp()} MQTT订阅失败: ${err.message}`);
                        } else {
                            $.DoubleLog(`✅MQTT订阅成功: ${topic}`);
                        }
                    });
                });

                // 立即执行一次状态更新
                await this.updateAndSendStatus();
                // 启动定时更新
                this.startStatusUpdateInterval();
            });

            // 重连事件
            this.mqttClient.on('reconnect', () => {
                $.DoubleLog(`🔄MQTT正在重连...使用客户端ID: ${mqttConfig.clientId}`);
            });

            // 错误处理
            this.mqttClient.on('error', (err) => {
                $.DoubleLog(`❌ ${getFormattedTimestamp()} MQTT连接错误: ${err.message}`);
            });

            // 断开连接处理
            this.mqttClient.on('close', () => {
                $.DoubleLog(`MQTT连接关闭`);
                
                // 清理定时器
                if (this.statusUpdateInterval) {
                    clearInterval(this.statusUpdateInterval);
                    this.statusUpdateInterval = null;
                }
            });
            
            // 连接结束事件
            this.mqttClient.on('end', () => {
                $.DoubleLog(`MQTT连接已结束`);
                this.mqttClient = null;
            });

            // 消息处理（保持原有逻辑）
            this.mqttClient.on('message', async (topic, message) => {
                try {
                    const topicParts = topic.split('/');
                    const deviceType = topicParts[1];  // 'switch' 或 'button' 或 'number'
                    const command = topicParts[3];     // 命令类型
                    const action = topicParts[4];      // 'set' 或 'press'
                    const state = message.toString();

                    // 处理充电桩开关命令
                    if (topic.startsWith('homeassistant/switch/geely_pile_') && topic.endsWith('/charging/set')) {
                        const pileCode = topic.split('/')[2].replace('geely_pile_', '');
                        await this.refresh_token();
                        if (state === 'ON') {
                            $.DoubleLog(`🔌 ${getFormattedTimestamp()} 正在启动充电: ${pileCode}`);
                            await this.doCharge(pileCode, "0");
                        } else {
                            $.DoubleLog(`🔌 ${getFormattedTimestamp()} 正在停止充电: ${pileCode}`);
                            await this.doCharge(pileCode, "1");
                        }
                        // 等待状态更新
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        await this.sendChargingPileStatusMqtt();
                        return;
                    }

                    // 处理温度设置
                    if (deviceType === 'number' && command === 'ac_temp' && action === 'set') {
                        const temp = parseFloat(state);
                        if (!isNaN(temp) && temp >= 16 && temp <= 32) {
                            this.acTemp = temp;  // 保存设置的温度
                            $.DoubleLog(`✅空调温度设置为: ${temp}°C`);
                            
                            // 如果空调已开启，则使用新温度重新设置
                            if (this.vehicleStatus.vehicleClimateStatus?.preClimateActive) {
                                await this.aconopen(temp);
                            }
                            
                            // 更新状态
                            const sensorTopic = `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`;
                            await this.sendMqttMessage(sensorTopic, {
                                ...this.lastSensorData,
                                ac_temp: temp
                            });
                        }
                        return;
                    }

                    // 处理按钮按下事件
                    if (deviceType === 'button' && action === 'press') {
                        let success = false;
                        switch(command) {
                            case 'rapidheat':
                                await this.rapidheat();
                                success = true;
                                break;
                            case 'rapidcool':
                                await this.rapidcool();
                                success = true;
                                break;
                            case 'search':
                                await this.search();
                                success = true;
                                break;
                            case 'windowslightopen':
                                await this.windowslightopen();
                                success = true;
                                break;
                            case 'windowfullopen':
                                await this.windowfullopen();
                                success = true;
                                break;
                            case 'windowclose':
                                await this.windowclose();
                                success = true;
                                break;
                        }
                        
                        if (success) {
                            $.DoubleLog(`✅按钮命令执行成功: ${command}`);
                            // 重新启动状态更新定时器
                            await this.startStatusUpdateInterval();
                            
                            // 等待车辆状态更新
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            // 更新并发送状态
                            await this.updateAndSendStatus();
                        }
                        return;
                    }

                    // 原有的开关处理逻辑保持不变
                    if (deviceType === 'switch' && action === 'set') {
                        // ... 现有的开关处理代码 ...
                    }

                    // 刷新token
                    await this.refresh_token();
                    if (!this.ckStatus) {
                        $.DoubleLog(`❌ ${getFormattedTimestamp()} 账号CK失效，无法执行命令`);
                        return;
                    }

                    // 执行命令
                    let success = false;
                    if (state === 'ON') {
                        switch(command) {
                            case 'sentry':
                                await this.opensentry();
                                success = true;
                                break;
                            case 'door':
                                await this.opendoor();
                                success = true;
                                break;
                            case 'ac':
                                await this.aconopen();
                                success = true;
                                break;
                            case 'defrost':
                                await this.defrostopen();
                                success = true;
                                break;
                            case 'purifier':
                                await this.purifieropen();
                                success = true;
                                break;
                            case 'sunroof':
                                await this.sunroofopen();
                                success = true;
                                break;
                            case 'sunshade':
                                await this.sunshadeopen();
                                success = true;
                                break;
                        }
                    } else if (state === 'OFF') {
                        switch(command) {
                            case 'sentry':
                                await this.closesentry();
                                success = true;
                                break;
                            case 'door':
                                await this.closedoor();
                                success = true;
                                break;
                            case 'ac':
                                await this.aconclose();
                                success = true;
                                break;
                            case 'defrost':
                                await this.defrostclose();
                                success = true;
                                break;
                            case 'purifier':
                                await this.purifierclose();
                                success = true;
                                break;
                            case 'sunroof':
                                await this.sunroofclose();
                                success = true;
                                break;
                            case 'sunshade':
                                await this.sunshadeclose();
                                success = true;
                                break;
                        }
                    }
                    
                    if (success) {
                        $.DoubleLog(`✅命令执行成功: ${command} ${state}`);
                        // 重新启动状态更新定时器
                        await this.startStatusUpdateInterval();

                        // 更新传感器状态
                        const sensorTopic = `homeassistant/sensor/geely_${this.vehicleInfo.vin}/state`;
                        const currentStatus = {
                            // 使用统一的状态检测方法，但当前命令使用临时状态
                            sentry_mode: command === 'sentry' ? state : this.checkStatus('sentry'),
                            door_state: command === 'door' ? state : this.checkStatus('door'),
                            ac_state: command === 'ac' ? state : this.checkStatus('ac'),
                            defrost_state: command === 'defrost' ? state : this.checkStatus('defrost'),
                            purifier_state: command === 'purifier' ? state : this.checkStatus('purifier'),
                            sunroof_state: command === 'sunroof' ? state : this.checkStatus('sunroof'),
                            sunshade_state: command === 'sunshade' ? state : this.checkStatus('sunshade')
                        };
                        await this.sendMqttMessage(sensorTopic, currentStatus);
                        
                        // 等待车辆状态更新
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        // 更新并发送状态
                        await this.updateAndSendStatus();
                    } else {
                        $.DoubleLog(`❌ ${getFormattedTimestamp()} 未知命令或状态: ${command} ${state}`);
                    }
                } catch (e) {
                    $.DoubleLog(`❌ ${getFormattedTimestamp()} 处理命令失败: ${e.message}`);
                    console.log(e);
                }
            });

        } catch (e) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} MQTT初始化失败: ${e.message}`);
            console.log(e);
        }
    }

    // 启动状态更新定时器
    async startStatusUpdateInterval() {
        // 如果已经有定时器在运行，先清除
        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
        }

        // 立即执行一次状态更新
        await this.updateAndSendStatus();

        // 设置定时器，按照配置的间隔时间更新状态
        this.statusUpdateInterval = setInterval(async () => {
            await this.updateAndSendStatus();
        }, mqttConfig.updateInterval * 1000); // 将秒转换为毫秒
        
        $.DoubleLog(`✅信息更新定时器已启动，每${mqttConfig.updateInterval}秒更新一次`);
    }

    // 更新并发送状态的函数
    async updateAndSendStatus() {
        try {
            // 刷新token
            await this.refresh_token();
            if (!this.ckStatus) {
                process.stdout.write('');
                $.DoubleLog(`❌ ${getFormattedTimestamp()} 账号CK失效，无法更新状态`);
                return;
            }
            // 同步刷新充电模块token
            await this.refreshRechargeToken();

            // 获取车辆各种信息
            await this.getVehicleInfo();
            // 发送状态到MQTT
            await this.sendVehicleStatusMqtt();
            
            // 使用 process.stdout.write 和 '\r' 实现单行更新日志
            const currentTime = getFormattedTimestamp();
            process.stdout.write(`✅ ${currentTime} 车辆状态已更新并发送到MQTT\r`);
        } catch (e) {
            // 在输出错误信息前先换行，以免覆盖状态行
            process.stdout.write('');
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 获取车辆信息失败: ${e.message}`);
            console.log(e);
        }
    }


    // 添加统一的状态检测方法
    checkStatus(type) {
        const check = this.statusChecks[type];
        if (!check) {
            $.DoubleLog(`❌ ${getFormattedTimestamp()} 未知的状态检测类型: ${type}`);
            return false;
        }
        return check() ? 'ON' : 'OFF';
    }

}



// *********************************************************
// 变量检查与处理
!(async () => {
    const userCookie = ($.isNode() ? process.env[ckName] : $.getdata(ckName)) || "";
    if (!userCookie) {
        console.log("未找到CK");
        return;
    }
    // 获取命令行参数
    const args = process.argv.slice(2);
    const user = new UserInfo(userCookie);
    await user.main(args);  // 直接传入参数数组，可能为空
    await $.SendMsg(msg);
})().catch((e) => console.log(e)).finally(() => $.done());

// ********************************************************
function httpRequest(options, method = null) {
    method = options.method ? options.method.toLowerCase() : options.body ? "post" : "get";
    return new Promise((resolve) => {
        $[method](options, (err, resp, data) => {
            if (err) {
                console.log(`${method}请求失败`);
                $.logErr(err);
            } else {
                if (data) {
                    try { data = JSON.parse(data); } catch (error) { }
                    resolve(data);
                } else {
                    console.log(`请求api返回数据为空，请检查自身原因`);
                }
            }
            resolve();
        });
    });
}
// ==================== API ==================== // 
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return ("POST" === e && (s = this.post), new Promise((e, a) => { s.call(this, t, (t, s, r) => { t ? a(t) : e(s) }) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new (class { constructor(t, e) { this.userList = []; this.userIdx = 0; (this.name = t), (this.http = new s(this)), (this.data = null), (this.dataFile = "box.dat"), (this.logs = []), (this.isMute = !1), (this.isNeedRewrite = !1), (this.logSeparator = "\n"), (this.encoding = "utf-8"), (this.startTime = new Date().getTime()), Object.assign(this, e), this.log("", `🔔${this.name},开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null) { try { return JSON.stringify(t) } catch { return e } } getjson(t, e) { let s = e; const a = this.getdata(t); if (a) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e) => { this.get({ url: t }, (t, s, a) => e(a)) }) } runScript(t, e) { return new Promise((s) => { let a = this.getdata("@chavy_boxjs_userCfgs.httpapi"); a = a ? a.replace(/\n/g, "").trim() : a; let r = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); (r = r ? 1 * r : 20), (r = e && e.timeout ? e.timeout : r); const [i, o] = a.split("@"), n = { url: `http:// ${o}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: r }, headers: { "X-Key": i, Accept: "*/*" }, timeout: r, }; this.post(n, (t, e, a) => s(a)) }).catch((t) => this.logErr(t)) } loaddata() { if (!this.isNode()) return {}; { (this.fs = this.fs ? this.fs : require("fs")), (this.path = this.path ? this.path : require("path")); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), a = !s && this.fs.existsSync(e); if (!s && !a) return {}; { const a = s ? t : e; try { return JSON.parse(this.fs.readFileSync(a)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { (this.fs = this.fs ? this.fs : require("fs")), (this.path = this.path ? this.path : require("path")); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), a = !s && this.fs.existsSync(e), r = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, r) : a ? this.fs.writeFileSync(e, r) : this.fs.writeFileSync(t, r) } } lodash_get(t, e, s) { const a = e.replace(/\[(\d+)\]/g, ".$1").split("."); let r = t; for (const t of a) if (((r = Object(r)[t]), void 0 === r)) return s; return r } lodash_set(t, e, s) { return Object(t) !== t ? t : (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), (e.slice(0, -1).reduce((t, s, a) => Object(t[s]) === t[s] ? t[s] : (t[s] = Math.abs(e[a + 1]) >> 0 == +e[a + 1] ? [] : {}), t)[e[e.length - 1]] = s), t) } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, a] = /^@(.*?)\.(.*?)$/.exec(t), r = s ? this.getval(s) : ""; if (r) try { const t = JSON.parse(r); e = t ? this.lodash_get(t, a, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, a, r] = /^@(.*?)\.(.*?)$/.exec(e), i = this.getval(a), o = a ? ("null" === i ? null : i || "{}") : "{}"; try { const e = JSON.parse(o); this.lodash_set(e, r, t), (s = this.setval(JSON.stringify(e), a)) } catch (e) { const i = {}; this.lodash_set(i, r, t), (s = this.setval(JSON.stringify(i), a)) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return (this.data = this.loaddata()), this.data[t]; default: return (this.data && this.data[t]) || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return ((this.data = this.loaddata()), (this.data[e] = t), this.writedata(), !0); default: return (this.data && this.data[e]) || null } } initGotEnv(t) { (this.got = this.got ? this.got : require("got")), (this.cktough = this.cktough ? this.cktough : require("tough-cookie")), (this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar()), t && ((t.headers = t.headers ? t.headers : {}), void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar)) } get(t, e = () => { }) { switch ((t.headers && (delete t.headers[""]), this.getEnv())) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && ((t.headers = t.headers || {}), Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, (t, s, a) => { !t && s && ((s.body = a), (s.statusCode = s.status ? s.status : s.statusCode), (s.status = s.statusCode)), e(t, s, a) }); break; case "Quantumult X": this.isNeedRewrite && ((t.opts = t.opts || {}), Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t) => { const { statusCode: s, statusCode: a, headers: r, body: i, bodyBytes: o, } = t; e(null, { status: s, statusCode: a, headers: r, body: i, bodyBytes: o, }, i, o) }, (t) => e((t && t.error) || "UndefinedError")); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", (t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), (e.cookieJar = this.ckjar) } } catch (t) { this.logErr(t) } }).then((t) => { const { statusCode: a, statusCode: r, headers: i, rawBody: o, } = t, n = s.decode(o, this.encoding); e(null, { status: a, statusCode: r, headers: i, rawBody: o, body: n, }, n) }, (t) => { const { message: a, response: r } = t; e(a, r, r && s.decode(r.rawBody, this.encoding)) }) } } post(t, e = () => { }) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch ((t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), this.getEnv())) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && ((t.headers = t.headers || {}), Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, (t, s, a) => { !t && s && ((s.body = a), (s.statusCode = s.status ? s.status : s.statusCode), (s.status = s.statusCode)), e(t, s, a) }); break; case "Quantumult X": (t.method = s), this.isNeedRewrite && ((t.opts = t.opts || {}), Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t) => { const { statusCode: s, statusCode: a, headers: r, body: i, bodyBytes: o, } = t; e(null, { status: s, statusCode: a, headers: r, body: i, bodyBytes: o, }, i, o) }, (t) => e((t && t.error) || "UndefinedError")); break; case "Node.js": let a = require("iconv-lite"); this.initGotEnv(t); const { url: r, ...i } = t; this.got[s](r, i).then((t) => { const { statusCode: s, statusCode: r, headers: i, rawBody: o, } = t, n = a.decode(o, this.encoding); e(null, { status: s, statusCode: r, headers: i, rawBody: o, body: n }, n) }, (t) => { const { message: s, response: r } = t; e(s, r, r && a.decode(r.rawBody, this.encoding)) }) } } time(t, e = null) { const s = e ? new Date(e) : new Date(); let a = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds(), }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in a) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? a[e] : ("00" + a[e]).substr(("" + a[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let a = t[s]; null != a && "" !== a && ("object" == typeof a && (a = JSON.stringify(a)), (e += `${s}=${a}&`)) } return (e = e.substring(0, e.length - 1)), e } msg(e = t, s = "", a = "", r) { const i = (t) => { switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: { let e = t.url || t.openUrl || t["open-url"]; return { url: e } } case "Loon": { let e = t.openUrl || t.url || t["open-url"], s = t.mediaUrl || t["media-url"]; return { openUrl: e, mediaUrl: s } } case "Quantumult X": { let e = t["open-url"] || t.url || t.openUrl, s = t["media-url"] || t.mediaUrl, a = t["update-pasteboard"] || t.updatePasteboard; return { "open-url": e, "media-url": s, "update-pasteboard": a, } } case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, a, i(r)); break; case "Quantumult X": $notify(e, s, a, i(r)); break; case "Node.js": }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣==============",]; t.push(e), s && t.push(s), a && t.push(a), console.log(t.join("\n")), (this.logs = this.logs.concat(t)) } } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name},错误!`, t); break; case "Node.js": this.log("", `❗️${this.name},错误!`, t.stack) } } wait(t) { return new Promise((e) => setTimeout(e, t)) } DoubleLog(d) { if (this.isNode()) { if (d) { console.log(`${d}`); msg += `\n ${d}` } } else { console.log(`${d}`); msg += `\n ${d}` } } async SendMsg(m) { if (!m) return; if (Notify > 0) { if (this.isNode()) { var notify = require("./sendNotify"); await notify.sendNotify(this.name, m) } else { this.msg(this.name, "", m) } } else { console.log(m) } } done(t = {}) { const e = new Date().getTime(), s = (e - this.startTime) / 1e3; switch ((this.log("", `🔔${this.name},结束!🕛${s}秒`), this.log(), this.getEnv())) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } })(t, e) }
// Env rewrite:smallfawn Update-time:23-6-30 newAdd:DoubleLog & SendMsg
