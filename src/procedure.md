这份API文档涵盖了当前系统的核心接口。让我为你讲述完整的业务流程和接口调用顺序：

---

## 完整业务流程

### **场景：用户从登录到完成一笔交易的完整流程**

---

## 阶段1：用户注册与登录

### 1.1 首次使用（新用户）

**流程：**
```
用户点击登录 
  ↓
前端跳转到SSO系统
  ↓
SSO返回授权码(code)
  ↓
POST /user/login (带code)
  ↓
后端返回："用户未注册" + openId
  ↓
前端生成Signal协议密钥对
  - identityKey (长期身份密钥)
  - signedPreKey (签名预密钥)
  - preKey (一次性预密钥)
  - signingKey (签名密钥)
  ↓
POST /user/register (上传公钥)
  ↓
后端返回：userInfo + token
  ↓
前端存储：
  - localStorage: token, userInfo
  - IndexedDB: 私钥（加密存储）
```

**关键接口调用：**
```javascript
// 1. 尝试登录
const loginRes = await axios.post('/user/login', {}, {
  headers: { code: ssoAuthCode }
});

if (loginRes.data.code === 0 && loginRes.data.data.openId) {
  // 2. 需要注册，生成密钥
  const keyBundle = await signalService.generateKeyBundle();
  
  // 3. 上传公钥注册
  const registerRes = await axios.post('/user/register', {
    userId: openId,
    identityKey: keyBundle.identityKey,
    signedPreKey: keyBundle.signedPreKey,
    preKey: keyBundle.preKey,
    signingPubKey: keyBundle.signingPubKey
  });
  
  // 4. 保存token和私钥
  localStorage.setItem('token', registerRes.data.data.token);
  await signalService.storeKeys(keyBundle.privateKeys);
}
```

### 1.2 已注册用户登录

**流程：**
```
SSO授权 → POST /user/login → 直接返回token → 建立WebSocket连接
```

---

## 阶段2：初始化连接与数据同步

### 2.1 建立WebSocket连接

**流程：**
```
登录成功
  ↓
建立WebSocket: WS /ws?userId=xxx&token=xxx
  ↓
服务器返回: {"type": "connected", ...}
  ↓
前端设置消息监听器
```

**代码示例：**
```javascript
const ws = new WebSocket(`wss://api.example.com/ws?userId=${userId}&token=${token}`);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  switch(msg.type) {
    case 'message':
      handleP2PMessage(msg.data);
      break;
    case 'group_message':
      handleGroupMessage(msg.data);
      break;
    case 'key_distribution':
      handleKeyDistribution(msg.data);
      break;
  }
};
```

### 2.2 加载订单列表

**流程：**
```
WebSocket连接成功
  ↓
GET /api/orders/my-orders
  ↓
返回订单列表（含conversationId）
  ↓
前端渲染订单卡片
```

### 2.3 同步离线消息

**流程：**
```
订单列表加载完成
  ↓
GET /api/p2p/messages/offline (获取P2P离线消息)
GET /api/groups/{groupId}/messages/offline (获取群组离线消息)
  ↓
解密消息
  ↓
存储到本地IndexedDB
  ↓
PUT /api/p2p/messages/{messageId}/status (标记为已送达)
  ↓
服务器删除已送达的离线消息
```

---

## 阶段3：磋商阶段（P2P通信）

### 3.1 用户选择订单开始磋商

**流程：**
```
用户点击订单
  ↓
GET /api/orders/{orderId} (获取订单详情)
  ↓
从IndexedDB加载本地消息历史
  ↓
渲染聊天界面
```

### 3.2 发送第一条消息（建立会话）

**关键步骤：**
```
用户输入文本点击发送
  ↓
检查是否有对方的Session
  ↓
如果没有：
  GET /api/users/{recipientId}/keys (获取对方公钥包)
  ↓
  使用Signal Protocol建立Session
  ↓
加密消息内容
  ↓
通过WebSocket发送：
  {
    "type": "message",
    "data": {
      "id": "msg_xxx",
      "recipientId": "user_002",
      "encryptedContent": "{...}",
      "messageType": "text",
      "timestamp": 1704067200000
    }
  }
  ↓
如果WebSocket断开，降级为HTTP：
  POST /api/p2p/messages/send
  ↓
保存到本地IndexedDB
  ↓
更新UI（乐观更新）
```

**代码流程：**
```javascript
async function sendMessage(recipientId, content) {
  // 1. 获取或建立Session
  let session = await getSession(recipientId);
  if (!session) {
    const keyBundle = await axios.get(`/api/users/${recipientId}/keys`);
    session = await signalProtocol.buildSession(keyBundle.data.data);
  }
  
  // 2. 加密消息
  const encrypted = await signalProtocol.encrypt(session, content);
  
  // 3. 构造消息
  const message = {
    id: generateMessageId(),
    senderId: currentUserId,
    recipientId: recipientId,
    encryptedContent: JSON.stringify(encrypted),
    messageType: 'text',
    timestamp: Date.now()
  };
  
  // 4. 发送（优先WebSocket）
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'message',
      data: message
    }));
  } else {
    await axios.post('/api/p2p/messages/send', message);
  }
  
  // 5. 保存到本地
  await indexedDB.messages.add(message);
  
  // 6. 更新UI
  updateMessageList(message);
}
```

### 3.3 接收消息

**流程：**
```
WebSocket收到消息
  ↓
{
  "type": "message",
  "data": {
    "id": "msg_xxx",
    "senderId": "user_002",
    "encryptedContent": "{...}",
    ...
  }
}
  ↓
使用Signal Protocol解密
  ↓
保存到IndexedDB
  ↓
渲染到UI
  ↓
发送已读回执（可选）：
  POST /api/p2p/messages/mark-read
```

---

## 阶段4：群组磋商（多方参与）

### 4.1 创建群组（系统自动或手动）

**流程：**
```
订单需要多方参与
  ↓
POST /api/groups/create
{
  "groupId": "group_001",
  "memberIds": ["user_001", "user_002", "user_003"]
}
  ↓
后端创建群组
  ↓
通过WebSocket通知所有成员：
{
  "type": "group_created",
  "data": {
    "groupId": "group_001",
    "adminId": "user_001",
    "memberIds": [...]
  }
}
```

### 4.2 分发Sender Key

**第一次发消息时：**
```
用户要发送群消息
  ↓
检查本地是否有该群的Sender Key
  ↓
如果没有：
  生成Sender Key
  ↓
  创建Distribution Message
  ↓
  POST /api/groups/keys/distribute
  {
    "groupId": "group_001",
    "distributionMessage": "{...}"
  }
  ↓
  其他成员通过WebSocket收到：
  {
    "type": "key_distribution",
    "data": {...}
  }
  ↓
  其他成员存储Sender Key
```

### 4.3 发送群组消息

**流程：**
```
用户发送群消息
  ↓
使用Sender Key加密
  ↓
通过WebSocket发送：
{
  "type": "group_message",
  "data": {
    "id": "msg_xxx",
    "groupId": "group_001",
    "encryptedContent": "{...}",
    ...
  }
}
  ↓
服务器广播给所有群成员
  ↓
成员收到后用Sender Key解密
```

---

## 阶段5：文件传输

### 5.1 发送文件

**流程：**
```
用户选择文件
  ↓
在客户端生成AES密钥
  ↓
使用AES加密文件
  ↓
POST /api/files/upload (上传加密文件)
multipart/form-data {
  file: <encrypted_data>,
  fileId: "file_xxx",
  userId: "user_001"
}
  ↓
后端返回: downloadUrl
  ↓
构造消息（包含fileId和AES密钥）
  ↓
使用Signal/Sender Key加密消息
  ↓
发送消息（消息内包含文件元数据和AES密钥）
```

**代码示例：**
```javascript
async function sendFile(recipientId, file) {
  // 1. 生成AES密钥并加密文件
  const aesKey = crypto.getRandomValues(new Uint8Array(32));
  const encryptedFile = await aesEncrypt(file, aesKey);
  
  // 2. 上传加密文件
  const formData = new FormData();
  formData.append('file', encryptedFile);
  formData.append('fileId', generateFileId());
  formData.append('userId', currentUserId);
  
  const uploadRes = await axios.post('/api/files/upload', formData);
  
  // 3. 构造包含密钥的消息
  const message = {
    type: 'file',
    content: `[文件] ${file.name}`,
    metadata: {
      fileId: uploadRes.data.data.fileId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      aesKey: base64Encode(aesKey), // AES密钥
      downloadUrl: uploadRes.data.data.downloadUrl
    }
  };
  
  // 4. 使用Signal Protocol加密消息（包含AES密钥）
  const encryptedMsg = await signalProtocol.encrypt(session, JSON.stringify(message));
  
  // 5. 发送
  await sendMessage(recipientId, encryptedMsg);
}
```

### 5.2 接收并下载文件

**流程：**
```
收到文件消息
  ↓
解密消息（获取fileId和AES密钥）
  ↓
用户点击下载
  ↓
GET /api/files/download/{fileId}
  ↓
下载加密文件
  ↓
使用消息中的AES密钥解密
  ↓
保存到本地
```

---

## 阶段6：合同签署

### 6.1 创建合同

**流程：**
```
磋商达成一致
  ↓
一方点击"创建合同"
  ↓
前端生成合同文本
  ↓
将合同加密为文件上传
  ↓
POST /api/contracts/create
{
  "orderId": "order_001",
  "title": "购销合同",
  "fileId": "file_contract_001",
  "fileHash": "sha256(...)",
  "participants": [
    {"userId": "user_001", "role": "buyer", "signatureOrder": 1},
    {"userId": "user_002", "role": "seller", "signatureOrder": 2}
  ]
}
  ↓
后端创建合同记录
  ↓
通过WebSocket或消息通知对方
```

### 6.2 签署合同

**流程：**
```
用户收到合同通知
  ↓
GET /api/contracts/{contractId} (获取合同详情)
  ↓
下载并解密合同文件
  ↓
用户阅读并确认
  ↓
使用私钥对合同哈希签名
  ↓
POST /api/contracts/{contractId}/sign
{
  "signature": "base64_signature",
  "signerPublicKey": "base64_pubkey",
  "timestamp": 1704067400000
}
  ↓
后端验证签名顺序和有效性
  ↓
如果是最后一个签名者，合同状态变为"completed"
  ↓
通知所有参与方
```

**代码示例：**
```javascript
async function signContract(contractId) {
  // 1. 获取合同
  const contract = await axios.get(`/api/contracts/${contractId}`);
  
  // 2. 下载并解密合同文件
  const encryptedFile = await axios.get(`/api/files/download/${contract.fileId}`);
  const fileContent = await decryptFile(encryptedFile);
  
  // 3. 计算文件哈希
  const fileHash = await sha256(fileContent);
  
  // 4. 验证哈希一致性
  if (fileHash !== contract.fileHash) {
    throw new Error('文件被篡改');
  }
  
  // 5. 使用私钥签名
  const signature = await ed25519.sign(privateKey, fileHash);
  
  // 6. 提交签名
  await axios.post(`/api/contracts/${contractId}/sign`, {
    signature: base64Encode(signature),
    signerPublicKey: base64Encode(publicKey),
    timestamp: Date.now()
  });
}
```

---

## 阶段7：订单完成

**流程：**
```
合同签署完成
  ↓
双方完成交易
  ↓
一方确认完成（通过后端业务系统）
  ↓
订单状态更新为"completed"
  ↓
系统记录信誉评分
```

---

## 关键技术点总结

### 1. **密钥交换时机**
- P2P首次通信时：GET /api/users/{userId}/keys
- 群组创建时：POST /api/groups/keys/distribute

### 2. **消息持久化策略**
- **服务器**：仅临时存储加密的离线消息（7天）
- **客户端**：IndexedDB存储所有历史消息

### 3. **双通道发送**
- **优先**：WebSocket实时发送
- **降级**：HTTP POST接口

### 4. **加密层次**
- **消息内容**：Signal/Sender Key加密
- **文件内容**：AES加密
- **文件密钥**：随消息通过Signal/Sender Key加密传递

### 5. **关键数据流**
```
用户输入 → Signal加密 → WebSocket/HTTP → 服务器中转 
→ 对方WebSocket接收 → Signal解密 → 显示
```

---

这就是完整的接口调用流程。所有接口都是基于你之前开发的端到端加密架构设计的，服务器始终不知道消息明文。