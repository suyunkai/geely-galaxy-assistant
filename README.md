# 吉利银河青龙脚本

## 功能介绍
- 查询车辆信息（位置、电量、温度等）
- 打开/关闭哨兵模式
- 每日签到获取积分
- 查询积分
- 车辆远程控制（车锁、空调、车窗等）
- 支持 MQTT 服务，可接入 HomeAssistant

## 依赖要求
- mqtt

## 使用说明

### 1. 环境变量配置
- 变量名：`jlyh`
- 变量值格式：`refreshToken值&deviceSN值`
- 获取方式：
  - 方式一：抓取 `https://galaxy-user-api.geely.com/api/v1/login/refresh?refreshToken=` 后面的值
  - 方式二：抓取短信登录包 `https://galaxy-user-api.geely.com/api/v1/login/mobileCodeLogin` 返回体中的 refreshToken 值
  - 两种方式都需要加上 `&` 和请求头 headers 中的 deviceSN 值

> **注意**：
> - 吉利银河 app 异地登录会互相顶掉，每次重新登录都需要重新抓包
> - 安卓设备实测不需要根证书，用户证书也能抓，可能需要配合 PC 端 Reqable
> - 脚本基于银河E5开发，吉利银河的其它车型可能部分功能异常

### 2. 定时任务配置
- 任务名称：jlyh
- 执行命令：jlyh.js
- 支持的运行参数：
  - `jlyh.js all` - 执行所有功能
  - `jlyh.js mqtt` - 开启 MQTT 监听（需单独运行）
  - `jlyh.js info` - 仅执行信息获取
  - `jlyh.js sign` - 仅执行签到
  - `jlyh.js opensentry` - 仅执行打开哨兵
  - `jlyh.js sign opensentry` - 执行签到和哨兵功能
  - `jlyh.js opendoor/closedoor` - 控制车锁
  - `jlyh.js aconopen/aconclose` - 控制空调
  - `jlyh.js defrostopen/defrostclose` - 控制除霜
  - `jlyh.js purifieropen/purifierclose` - 控制空气净化
  - `jlyh.js sunroofopen/sunroofclose` - 控制天窗
  - `jlyh.js sunshadeopen/sunshadeclose` - 控制遮阳帘
  - `jlyh.js windowslightopen` - 微开车窗
  - `jlyh.js windowfullopen` - 全开车窗
  - `jlyh.js windowclose` - 关闭车窗
  - `jlyh.js search` - 闪灯鸣笛
  - `jlyh.js rapidheat` - 极速升温
  - `jlyh.js rapidcool` - 极速降温

### 3. 通知设置
可通过以下两种方式控制通知：

1. 修改默认值：
   - `Notify = 0` - 默认通知（仅重要场景如哨兵开启、签到成功时通知）
   - `Notify = 1` - 强制开启通知（所有场景都通知）
   - `Notify = 2` - 强制关闭通知（所有场景都不通知）

2. 使用命令行参数：
   - `jlyh.js notify=1` - 强制开启通知
   - `jlyh.js notify=2` - 强制关闭通知

### 4. MQTT 配置
1. 在配置位置输入 MQTT 地址端口以及状态更新间隔（建议 60 秒）
2. 在 HomeAssistant 中添加 MQTT 代理，并配置 MQTT 客户端
3. 设置自动监听后，开启脚本将自动生成实体

#### MQTT 支持的功能
- 实时监控：
  - 车内外温度
  - 电池电量和充电状态
  - 车内 PM2.5
  - 总里程和续航里程
  - 车辆位置（当前无法获取正确经纬度，经纬度信息加密了，还没找到加密逻辑）
  - 各种开关状态
- 远程控制：
  - 哨兵模式开关
  - 车锁控制
  - 空调控制（含温度调节）
  - 除霜控制
  - 空气净化控制
  - 天窗和遮阳帘控制
  - 车窗控制
  - 闪灯鸣笛
  - 极速升温/降温

## 免责声明
- 本脚本仅供学习交流使用，请勿用于商业用途
- 使用本脚本所造成的一切后果，与作者无关
- 请遵守相关法律法规，不得用于非法用途

## 作者
微信：greenteacher46（加微信请说明来意，不接受免费咨询，可交流技术）
