# 评估流程图

![](images/小天才手表Z6s-diagram.png)

# 信息收集

根据《信息收集表-2》采集到的信息。有几个需要进行截图处理。

1、EMBA固件扫描（并截图index.html的图，里面包含密钥信息，配置文件等）。

2、漏洞扫描（如果有WiFi通信，能和Nessus扫描器连通，建Nessus扫描任务并截图 -- GEC-1）。

3、对客户端进行截图。



## 调试接口开启方法

经过了解后，小天才手表一共有两个系列，一个是高通系列，一个是展锐（紫光展锐）平台系列，分别用的是安卓版本和 RTOS 版本。两者的调试方法不太一样，而本次测试的手表 Z6s属于展锐版本。

### 小天才安卓版本

低版本固件：

<span style="color: rgb(216,57,49); background-color: inherit">Z9以下Z5以上（Z6直接*</span>[<span style="color: rgb(36,91,219); background-color: inherit">#0769651#</span>](https://search.bilibili.com/all?keyword=0769651\&from_source=web_dynamic_tag\&spm_id_from=333.1369.0.0)<span style="color: rgb(216,57,49); background-color: inherit">*）</span>

短接指的是通过两个短接点相互连通重启到9008(Edl)模式，每个型号的短接点都不一样，分辨是否是短接点，就注意是否是两个连在一起的金点点

首先准备一个导电的镊子或者说小天才官方机械表带的轴承，然后把小天才手表关机（屏幕熄灭后至少10秒）不能连数据线，充电线等，否则会直接重启，然后将镊子或者轴承对准两个点戳下去（注意不要戳太用力，否则戳坏了哭都来不及）确认对准后长按开机键，<span style="color: rgb(216,57,49); background-color: inherit">如果没有震动并亮起小天才LOGO就说明</span> <span style="color: rgb(46,161,33); background-color: inherit">成功短接了，注意短接的时间只有8~10秒</span> <span style="color: rgb(216,57,49); background-color: inherit">，如果失败了，请关机重试，检查是不是连了数据线？连了的话请摘掉（其实到这一步你大概已经开了</span> <span style="color: rgb(216,57,49); background-color: inherit">adb</span> <span style="color: rgb(216,57,49); background-color: inherit">了，不过时间只有短短的8秒）</span>

高版本固件：

二维码点击5下，长按绑定号

![](images/小天才手表Z6s-image-12.png)

校验码生成平台：

http://tiantech.zjjsw.com/xtc/XTCADBCode-Web-main/

https://xtc-code.onesoft.top/

输入校验码，选择开启调试接口即可。



### 小天才RTOS版本

Z6A / Z6S / Z6Pro：展锐 RTOS

不支持adb，只能使用rtos工具进行串口调试。

1、下载并安装驱动

![](images/小天才手表Z6s-image-11.png)

![](images/小天才手表Z6s-image-14.png)

2、短接，重启进入

2、下载RTOS COM调试工具，点击刷新，看是否有串口信息更新

![](images/小天才手表Z6s-image-13.png)

3、文件系统读取

输入暗码，并打开u盘模式

```plain&#x20;text
*#0769789#*
```

重启小天才，文件系统被正常读取：

![](images/小天才手表Z6s-image.png)

回到RTOS工具：

应用遍历正常，可进行读取，删除操作。

![](images/小天才手表Z6s-image-1.png)

4、固件提取







小天才快应用格式标准：https://developer.okii.com/qcdocs/framework/introduce.html

小天才第三方应用接入要求：https://developer.okii.com/docs/publish/02-resource-secure.html



抓包环境：

![](images/小天才手表Z6s-image-2.png)

192.168.1.209

ip.addr == 192.168.1.209



# 数据流图

![](images/小天才手表Z6s-diagram-1.png)



# 物理接口识别

> 流程：
>
> 1、读技术文档，识别物理外部接口
>
> 2、观察设备外壳及暴露的接口，识别物理外部接口
>
> 拍照设备正、反、侧面。（如果有一些比较隐秘的，如Sim卡卡槽，复位孔给出特写）

1、读技术文档，识别物理外部接口

查看官网，通过介绍能得知屏幕、摄像头、麦克风、蜂窝天线外部接口。

https://www.okii.com/html/pc/products/z6s.html

2、观察设备外壳及暴露的接口，识别物理外部接口

拍照设备正、反、侧面。（如果有一些比较隐秘的，如Sim卡卡槽，复位孔给出特写）

通过外部观察能识别到屏幕、摄像头、麦克风、充电口、复位孔等物理外部接口。

![](images/小天才手表Z6s-image-3.png)

![](images/小天才手表Z6s-image-4.png)

![](images/小天才手表Z6s-image-5.png)

![](images/小天才手表Z6s-image-6.png)

列出所有功能识别到的物理接口：

![](images/小天才手表Z6s-image-7.png)

与概念评估识别的物理接口对比，概念评估均已对物理接口进行记录。



# 外部接口识别

> 通用流程：
>
> 1、读技术文档，识别外部实体和功能
>
> 2、查看设备以及客户端
>
> 3、抓包分析，看外部实体连接
>
> 4、emba扫描，看配置文件中的连接url
>
> 5、nmap扫描，看监听端口和开启的服务
>
> 对每一项分别截图

1、读技术文档，识别外部实体和功能

https://www.okii.com/html/pc/products/z6s.html

2、查看设备以及客户端

![](images/小天才手表Z6s-image-8.png)

![](images/小天才手表Z6s-image-9.png)

![](images/小天才手表Z6s-image-10.png)

![](images/小天才手表Z6s-image-25.png)

3、抓包分析，看外部实体连接

4、emba扫描，看配置文件中的连接url

暂未获取到固件。

5、nmap扫描，看监听端口和开启的服务

tcp：

![](images/小天才手表Z6s-nmap-TCP-1.png)

udp：

![](images/小天才手表Z6s-nmap-UDP-1.png)

nmap扫描未发现监听端口。

通过以上方法，最终得到一份功能完整性测试的外部接口识别表：

![](images/小天才手表Z6s-image-24.png)

与概念评估中写的外部接口识别清单对比，未发现新的外部接口。



## 网络接口

> 网络接口流程：
>
> 1、对照网络接口checkList
>
> 如：是否存在WiFi、蓝牙、NFC、蜂窝等



## 机器接口

> 1、路由器抓包，通过边点击客户端边抓包方式识别通信服务
>
> eg.云端XXX-1地址通信 截图通信包



## 用户接口

> 1、主要看用户与设备交互的接口，如可视化界面，命令行等。
>
> 对界面功能进行截图。



# 资产识别

> 流程：
>
> 1、读技术文档/官网介绍等，了解设备功能、配置。
>
> 2、审查设备以及客户端，重点关注**网络配置、安全设置、软件更新、用户资料、钱包、付款**等模块及其详细用途。（选几个客户端截图）
>
> 3、抓包分析（根据网络接口给出数据包截图，如WiFi-wireshark/bp，蓝牙-蓝牙空口包，蜂窝-TCP/bp）
>
> 4、emba扫描，看操作系统、已安装的软件和组件、凭证信息、网络端口服务、配置信息、密码学资产(CCK-1、CRY-1)（用到的密码算法、密钥存放位置）。
>
> 5、nmap扫描，探测端口和服务
>
> 6、（Web服务）目录爆破
>
> 7、功能验证，概念评估中的资产是否都能被找到，功能识别时是否找到更多的资产。
>
> 经功能验证，资产均已记录在文档中。



1、读技术文档/官网介绍等，了解设备功能、配置。

https://www.okii.com/html/pc/products/z6s.html

![](images/小天才手表Z6s-image-15.png)

![](images/小天才手表Z6s-image-16.png)

2、审查设备以及客户端，重点关注**网络配置、安全设置、软件更新、用户资料、钱包、付款**等模块及其详细用途。

![](images/小天才手表Z6s-image-17.png)

![](images/小天才手表Z6s-image-18.png)

![](images/小天才手表Z6s-image-19.png)

![](images/小天才手表Z6s-image-20.png)

3、抓包分析（根据网络接口给出数据包截图，如WiFi-wireshark/bp，蓝牙-蓝牙空口包，蜂窝-TCP/bp）

通过wireshark初步分析：

发现大部分数据包进行了加密：

![](images/小天才手表Z6s-image-21.png)

![](images/小天才手表Z6s-image-22.png)

利用分析工具打开，逐一查看解析后的数据包，发现均进行加密：

![](images/小天才手表Z6s-image-23.png)

4、emba扫描，看操作系统、已安装的软件和组件、凭证信息、网络端口服务、配置信息、密码学资产(CCK-1、CRY-1)（用到的密码算法、密钥存放位置）。

5、nmap扫描，探测端口和服务

tcp：

![](images/小天才手表Z6s-nmap-TCP.png)

udp：

![](images/小天才手表Z6s-nmap-UDP.png)

经功能验证，资产均已记录在文档中。



## 个人信息识别

> 1、通过抓取通信数据包并做敏感信息匹配
>
> 2、通过观察可视化界面，客户端识别个人信息
>
> 其中个人信息包括个人数据、流量数据或位置数据，然后通过个人信息定位功能。
>
> 经功能验证，资产均已记录在文档中。



1、通过抓取通信数据包并做敏感信息匹配

通过抓包获取全量数据包：

![](images/小天才手表Z6s-image-40.png)

将pcap包导入到数据包分析工具，并进行敏感信息匹配：

经分析发现对请求体和响应体进行了加密，无法通过工具统一匹配个人信息。

![](images/小天才手表Z6s-image-38.png)

2、通过观察可视化界面，客户端识别个人信息

其中个人信息包括个人数据、流量数据或位置数据，然后通过个人信息定位功能。

![](images/小天才手表Z6s-image-39.png)

![](images/小天才手表Z6s-image-37.png)

![](images/小天才手表Z6s-image-26.png)

![](images/小天才手表Z6s-image-27.png)



# 功能评估

## ACM\&AUM\&SCM

ACM和AUM在评估有很大一部分测试流程和截图时重叠的，可以一起做，做完之后根据功能评估要求改变一下描述即可。

1、访问方式归类

> 1、对上面发现的每一种资产，列举出所有可能的访问方式（主要UI访问与云端接口通信）

访问控制机制的功能完整性评估：列出资产-访问方式表。

对于每一种访问方式，在边做概念评估时可边截图，如：

访问方式一：

> ACM-1：
>
> 是否适用于访问控制？
>
> 有，验证管理实体对资产访问的访问控制机制确实存在，且没有证据表明其未被实现。
>
> 截图访问控制方式。
>
>
>
> ACM-2：
>
> RBAC(角色)/DAC(自主)/MAC(强制)/Generic
>
> 一般都是按角色，或者通用。
>
> \[AU.ACM-2.Generic]
>
> C1."The \[assets are] only accessible by authorized users"
>
> 资产是否仅对授权用户开放访问？
>
> C2."The principle of least privileges for users is followed"
>
> 用户是否遵循最小权限原则？
>
> （文字描述）没有发现越权行为
>
> C3."changing settings related to the access control mechanism or changes of privileges of users are only allowed to be performed by authorized users.”
>
> 与访问控制机制相关的设置变更，或用户权限变更，是否仅允许授权用户执行？
>
> 查看是否存在与访问控制设置相关的功能，有则截图说明使用用户，无则说明无与访问控制相关的设置功能。
>
>
>
> ACM-4
>
> RBAC(角色)/DAC(自主)/MAC(强制)/Generic
>
> \[AU.ACM-4.Generic]
>
> C1."Other entities' third-parties' can only access children's privacy function and personal information processed by the equipment's privacy assets if necessary for the operation of the equipment"
>
> 仅在设备运行确有必要时，其他主体的第三方方可访问儿童隐私相关功能，以及由设备隐私资产处理的个人信息
>
>
>
> C2."The principle of least privileges for other entities' third-parties is followed"
>
> 第三方是否遵循最小权限原则？
>
> C3."Changing settings related to the access control mechanism or changes of privileges of other entities' third-parties' are only allowed to be performed by authorized users"
>
> 与访问控制机制相关的设置变更，或第三方权限变更，是否仅允许授权用户执行？



> AUM-1
>
> 已按照文档的方式实现认证机制。
>
> AUM-2-1
>
> 按照文档的细节实现了认证机制。



ip.addr == 192.168.1.209

云端相关的访问方式：

### 手机扫码绑定（NA）

通过物理扫描绑定号，及手表屏幕出现的10分钟有效验证码进行二次验证。

![](images/小天才手表Z6s-image-28.png)

![](images/小天才手表Z6s-image-29.png)

### 应用市场云端（http://storefs-pvt.watch.okii.com）

使用token做访问控制下载rpk。

使用http且明文。

![](images/小天才手表Z6s-image-30.png)

APP应用商店的APP均由小天才审核后上架，且应用格式为小天才自定义格式，上架流程如下：

https://developer.okii.com/docs/publish/01-shelf.html

![](images/小天才手表Z6s-image-31.png)

### 系统升级云端(http://t.xiaotiancai.com)

http且明文数据。

![](images/小天才手表Z6s-image-32.png)

得到差分包

![](images/小天才手表Z6s-image-33.png)

差分包分析：

请求头为OTA

![](images/小天才手表Z6s-image-34.png)

搜索签名相关关键词，发现RSA存在RSA相关内容。

![](images/小天才手表Z6s-image-35.png)

搜索证书头ASN.1 SEQUENCE





### 网络聊天云端(http://asr.okii.com:80)

网络聊天流程：手表通过http请求，user\_id、key和服务端认证，认证通过建立websocket连接，全程服务端响应体加密返回，未授权实体无法得知服务端的加密密钥和算法。

![](images/小天才手表Z6s-image-36.png)

![](images/小天才手表Z6s-image-54.png)

通过websocket方式传输网络聊天数据：

且内容已做加密。

![](images/小天才手表Z6s-image-53.png)

### SOS云端(tcp:101.201.37.93:8000)

手机端：手表设置-SOS紧急呼叫

通过tcp方式，云端下发命令

![](images/小天才手表Z6s-image-52.png)

### GPS定位/轨迹同步云端(http://location.watch.okii.com)

http://location.watch.okii.com

服务端响应体加密返回，未授权实体无法得知服务端的加密密钥和算法。

![](images/小天才手表Z6s-image-55.png)



其中Eebbk-Sign为签名字段。



### 步数同步云端(http://sport.watch.okii.com)

服务端响应体加密返回，未授权实体无法得知服务端的加密密钥和算法。

![](images/小天才手表Z6s-image-41.png)



### 蓝牙BLE通信

通过加好友等方式可触发BLE服务端的开启，名称为：XTC\_WATCH。

连接XTC\_WATCH，查看广播的BLE配置信息。



![](images/小天才手表Z6s-image-42.png)

![](images/小天才手表Z6s-image-43.png)

扫描：

![](images/小天才手表Z6s-image-44.png)

枚举：

![](images/小天才手表Z6s-image-45.png)

未授权测试：

经测试，BLE协议方面允许未授权对目标GATT特征执行读、写操作，无需配对、认证、加密。

![](images/小天才手表Z6s-image-46.png)

just-works配对方式。

![](images/小天才手表Z6s-image-47.png)

DOS攻击：

![](images/小天才手表Z6s-image-48.png)

安全通信：

抓kali的蓝牙适配器的包。过程中kali与BLE设备建立连接，发起配对等。

其中，配对数据包，查看pair request和pair response：

使用just works认证，未开启Secure connection，通信过程使用明文方式传输，且MITM:False不防止中间人攻击

![](images/小天才手表Z6s-image-49.png)



其中，IO Capability：输入输出能力（决定配对方式：Just Works、NIST、Passkey、OOB）

Authentication Requirements：Bonding flag：是否绑定（保存 LTK 长期密钥）、MITM flag：是否防御中间人攻击、Secure Connections：是否启用 LE Secure Connections（AES‑128，BLE4.2+）。

Key Distribution：协商分发哪些密钥（LTK、IRK、CSRK 等）。



### WiFi AP通信

通过换表助手进行数据迁移，手表会以AP形式开启WiFi局域网。

1、全频段扫描，找到MAC地址和SSID

sudo airodump-ng wlan0mon --band abg

74:D8:73:9B:31:36

![](images/小天才手表Z6s-image-50.png)

2、连接AP，查看是否需要口令

手机找到小天才的热点，需要输入口令。

![](images/小天才手表Z6s-image-51.png)

3、抓空中数据包，查看协议

sudo airodump-ng -c 11 --bssid 74:D8:73:9B:31:36 -w wifi\_capture wlan0mon

![](images/小天才手表Z6s-image-62.png)

![](images/小天才手表Z6s-image-61.png)

```yaml
Tag: RSN Information
    Tag Number: RSN Information (48)
    Tag length: 20
    RSN Version: 1
    Group Cipher Suite: 00:0f:ac (Ieee 802.11) AES (CCM)
        Group Cipher Suite OUI: 00:0f:ac (Ieee 802.11)
        Group Cipher Suite type: AES (CCM) (4)
    Pairwise Cipher Suite Count: 1
    Pairwise Cipher Suite List 00:0f:ac (Ieee 802.11) AES (CCM)
        Pairwise Cipher Suite: 00:0f:ac (Ieee 802.11) AES (CCM)
    Auth Key Management (AKM) Suite Count: 1
    Auth Key Management (AKM) List 00:0f:ac (Ieee 802.11) PSK
        Auth Key Management (AKM) Suite: 00:0f:ac (Ieee 802.11) PSK
            Auth Key Management (AKM) OUI: 00:0f:ac (Ieee 802.11)
            Auth Key Management (AKM) type: PSK (2)
    RSN Capabilities: 0x000c
        .... .... .... ...0 = RSN Pre-Auth capabilities: Transmitter does not support pre-authentication
        .... .... .... ..0. = RSN No Pairwise capabilities: Transmitter can support WEP default key 0 simultaneously with Pairwise key
        .... .... .... 11.. = RSN PTKSA Replay Counter capabilities: 16 replay counters per PTKSA/GTKSA/STAKeySA (0x3)
        .... .... ..00 .... = RSN GTKSA Replay Counter capabilities: 1 replay counter per PTKSA/GTKSA/STAKeySA (0x0)
        .... .... .0.. .... = Management Frame Protection Required: Not required
        .... .... 0... .... = Management Frame Protection Capable: Not capable
        .... ...0 .... .... = Joint Multi-band RSNA: Not supported
        .... ..0. .... .... = PeerKey Enabled: Not supported
        .... .0.. .... .... = SPP A-MSDU Capable: Not capable
        .... 0... .... .... = SPP A-MSDU Required: Not required
        ...0 .... .... .... = PBAC (protected block ack agreement capable): Not capable
        ..0. .... .... .... = Extended Key ID for Individually Addressed Frames: Not supported
        .0.. .... .... .... = OCVC: Not supported
```

使用WPA2-PSK，加密套件AES-CCM（CCMP）



### 蜂窝通信

按理说也是客户端。



### adb调试接口



## SUM

> SUM-1
>
> C1.更新可被成功安装，且对应软件组件已被有效更新。
>
>
>
> SUM-2
>
> sign:
>
> C1.密码算法符合CRY-1最佳实践
>
> C2.无签名的更新包不被安装
>
> C3.签名被篡改的更新包不被安装
>
> C4.内容被篡改但签名为原始合法签名的更新包不被安装
>
> C5.由未授权实体签名的更新包不被安装
>
> 1、是否存在签名
>
> 2、篡改签名安装
>
> 3、
>
> SecChan：
>
> 安全通信机制符合 SCM 要求
>
> 来自未授权来源的更新包不被安装
>
> 安全信道不允许通过中间人攻击冒充授权更新源
>
> 传输过程中被修改的更新包不被安装
>
>
>
> SUM-3
>
> 设备能够在无需设备端人工干预的情况下完成更新or设备能够在人工批准后按计划自动完成更新安装or设备能够在人工批准/监督下触发更新安装





### 系统更新

![](images/小天才手表Z6s-img_v3_0214g_0b70653f-51ac-42dc-9469-a2381ad11b6g.jpg)

![](images/小天才手表Z6s-img_v3_0214g_aecd1354-733b-42ee-b7c9-de564fca3e0g.jpg)

获取差分包

![](images/小天才手表Z6s-image-56.png)

通过差分包未找到签名信息。



设备能够在人工批准后按计划自动完成更新安装

![](images/小天才手表Z6s-img_v3_0214g_51cd31f1-cb8b-470e-b923-417859ca63ag.jpg)

![](images/小天才手表Z6s-img_v3_0214g_8fbf5f19-11b4-4fcc-88e8-2935c6f8f50g.jpg)



### 应用市场更新

![](images/小天才手表Z6s-img_v3_0214g_e637b836-60a5-4366-95f7-de73a571657g.jpg)

![](images/小天才手表Z6s-img_v3_0214g_66c762a4-0f34-49ee-bcd7-f22b29b9d44g.jpg)









APP应用商店的APP均由小天才审核后上架，且应用格式为小天才自定义格式，上架流程如下：

https://developer.okii.com/docs/publish/01-shelf.html

![](images/小天才手表Z6s-image-57.png)

使用http明文传输：

![](images/小天才手表Z6s-image-58.png)

通过解压分析，未发现签名信息。

![](images/小天才手表Z6s-image-59.png)

虽然应用需要审核后再上架，但传输过程使用http且明文传输。且安装包无签名信息。



设备能够在人工批准/监督下触发更新安装

![](images/小天才手表Z6s-img_v3_0214g_e637b836-60a5-4366-95f7-de73a571657g-1.jpg)

![](images/小天才手表Z6s-img_v3_0214g_66c762a4-0f34-49ee-bcd7-f22b29b9d44g-1.jpg)



## SSM

功能完整性：

> SSM-1：
>
> 可持久存储资产均已记录在文档中
>
> SSM-3：
>
>

功能充分性验证：

> SSM-1
>
> C1.网络/隐私/金融/安全资产已通过文档描述的安全存储机制进行持久存储
>
> 如概念评估描述，资产均已通过文档描述的安全存储机制进行持久存储。
>
> SSM-2
>
> AccessControl:
>
> C1.安全存储机制按照文档描述实现，并参照ACM评估结果
>
> C2.对资产的未授权修改不可能发生
>
> 引用ACM结果。
>
> SSM-3：
>
> C1.存储机制按照文档描述的访问控制方式实现
>
> C2.未授权读取存储的机密资产被拒绝





连接数据线后正常无法读取手表数据，唯有通过暗码方式可拉取。

![](images/小天才手表Z6s-image-60.png)



## DLM

功能完整性评估

> 评估可存储的个人数据及敏感安全参数。

功能充分性评估

> 删除机制能够删除文档中描述的个人数据和敏感安全参数

点击恢复出厂设置，概念评估中描述的个人信息和敏感安全参数均已成功清除

![](images/小天才手表Z6s-img_v3_0214h_9085220b-2af4-42a3-8d2a-cf16b3727e4g.jpg)

![](images/小天才手表Z6s-img_v3_0214h_a7486b94-e0ba-422d-9535-08f55b4fe98g.jpg)



全量重置

1、物理重置

2、软件重置

部分清理

3、删除聊天记录

4、删除APP、清除APP信息





## SCM

功能完整性评估

> 功能评估可被传输的资产，确认是否被被记录在概念评估中

功能充分性评估

> SCM-1
>
> 文档中的通信机制已被实现
>
> SCM-2：
>
> Generic：
>
> C1.用于保护真实性和完整性的密钥不能被截获和滥用
>
> C2.被篡改的消息不应被当作完整消息接受
>
> C3.未授权的消息不应被当作真实消息接受
>
> C4.不可能进行成功的中间人（MitM）攻击
>
> SCM-3：
>
> ChannelEnc：
>
> C1.用于加密消息的密钥不能被截获或窃听
>
> C2.消息的加密内容不能被窃听或泄露
>
> SCM-4：
>
> SeqNumb：
>
> 重复序列号消息拒绝



## UNM

功能完整性评估

> 功能评估所有个人信息以及对个人信息的变更场景用例

功能充分性测试

> UNM-1
>
> C1.每个变更用例至少有一个用户通知机制，且与概念评估UNM-1中描述的变更用例一致
>
> UNM-2
>
> C1.每个通知的实际内容与概念评估UNM-2中对变更通知的内容描述一致
>
> C2.每个通知内容满足UNM-2要求，即包含变更描述和变更对隐私保护的影响说明
>
> XXX通知方式与概念评估描述一致，且满足UNM-2要求，包含变更描述和变更对隐私保护的影响说明。



![](images/小天才手表Z6s-img_v3_0214h_66180665-6c76-4c19-811d-30db6ac28ffg.jpg)



## CCK

功能完整性评估

> CCK-1
>
> 找到所有由设备预置或在设备使用过程中生成的机密密钥(CCK)
>
> 识别方法：
>
> 1、查阅技术文档/官网介绍等
>
> 2、根据前面评估的AUM、SUM、SSM、SCM，总结出涉及的CCK，并进行列举。
>
> CCK-2
>
> 找到所有的密钥生成机制。
>
> 暂未发现更多密钥生成机制。
>
> CCK-3
>
> 找到所有预置的CCK
>
>

功能充分性评估

> CCK-1
>
> C1.实际密钥长度与概念评估中密钥长度描述一致
>
> XXX协议/算法（截图），为XXX套件，涉及到的密钥信息为XXX协议/算法要求，涉及到的密钥有：XXX，密钥长度与概念评估密钥长度描述一致。
>
>

1、查阅技术文档/官网介绍等进行了解

https://www.okii.com/html/pc/products/z6s.html



## GEC

功能完整性评估

> GEC-2
>
> 设备处于出厂默认状态下，列举暴露的网络接口和服务。
>
> GEC-3
>
> 所有可选网络接口或服务。
>
> GEC-4
>
> 出厂默认状态下，文档中列举的暴露的网络接口和服务是否完整（评估文档）
>
> GEC-5
>
> 发现任何通过设备暴露的物理外部接口，即使相关接口功能未启用。
>
> GEC-6
>
> 发现所有输入方法。
>
> GEC-7
>
> 发现可影响用户或订阅者隐私的非网络外部接口

功能充分性评估

> GEC-3
>
> C1.设备是否可配置（可选接口/服务支持启用和禁用）
>
> C2.可选接口/服务的状态确实可在"启用"和"禁用"之间切换
>
> C3.配置操作仅限授权用户（具备访问控制和认证机制）
>
> XXX接口需要在XXX位置中开启/关闭，且操作仅限于XX用户。
>
> GEC-4：无
>
> GEC-5：无
>
> GEC-6：
>
> C1.输入验证已按概念评估描述实施
>
> C2.设备对相关输入机制的攻击具有弹性



## CRY

功能完整性评估

> 列举所有用于保护资产的密码学机制
>
> 暂未发现在概念评估外用于保护资产的密码学机制。

功能充分性评估

> 使用密码学的机制按概念评估中描述实现，且无偏离文档的迹象。
>
> 如概念评估所描述，使用XXX密码学机制。

