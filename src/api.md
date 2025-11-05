你说得对，让我根据实际的端到端加密架构和系统设计重新整理API文档：

---

# 后端 API 接口文档

## 目录
- [1. 认证相关](#1-认证相关)
- [2. 用户公钥管理](#2-用户公钥管理)
- [3. 一对一消息](#3-一对一消息)
- [4. 群组管理](#4-群组管理)
- [5. 群组消息](#5-群组消息)
- [6. 文件服务](#6-文件服务)
- [7. WebSocket 连接](#7-websocket-连接)
- [8. 订单管理](#8-订单管理)
- [9. 合同管理](#9-合同管理)
- [10. 用户信息](#10-用户信息)

---

## 通用说明

### 认证方式
所有需要认证的接口都使用自定义 header：
```
token: <用户的JWT token>
```

### 通用响应格式
```json
{
  "code": 1,           // 1: 成功, 0: 失败
  "msg": "操作成功",
  "data": {}           // 具体数据
}
```

### 通用错误码
- `401` - 未授权（token 无效或过期）
- `403` - 禁止访问（权限不足）
- `404` - 资源不存在
- `429` - 请求过于频繁
- `500` - 服务器错误

---

## 1. 认证相关

### 1.1 单点登录回调
```
POST /user/login
```

**请求头：**
```
code: <SSO授权码>
```

**请求体：**
```json
{}
```

**成功响应 - 已注册用户：**
```json
{
  "code": 1,
  "msg": "登录成功",
  "data": {
    "userInfo": {
      "id": "user_001",
      "openid": "openid_123",
      "userName": "张三",
      "password": null
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**成功响应 - 未注册用户：**
```json
{
  "code": 0,
  "msg": "用户未注册",
  "data": {
    "openId": "openid_123"
  }
}
```

---

### 1.2 用户注册（上传公钥）
```
POST /user/register
```

**请求体：**
```json
{
  "userId": "openid_123",
  "identityKey": "base64_encoded_identity_key",
  "signedPreKey": {
    "keyId": 1,
    "publicKey": "base64_encoded_prekey",
    "signature": "base64_encoded_signature"
  },
  "preKey": {
    "keyId": 1,
    "publicKey": "base64_encoded_prekey"
  },
  "signingPubKey": "base64_encoded_signing_pubkey"
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "注册成功",
  "data": {
    "userInfo": {
      "id": "user_001",
      "openid": "openid_123",
      "userName": "张三",
      "password": null
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 1.3 登出
```
POST /user/logout
```

**请求头：**
```
token: <JWT token>
```

**请求体：**
```json
{}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "登出成功",
  "data": null
}
```

---

## 2. 用户公钥管理

### 2.1 获取用户公钥包
```
GET /api/users/:userId/keys
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `userId`: 目标用户ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "userId": "user_002",
    "identityKey": "base64_encoded_identity_key",
    "signedPreKey": {
      "keyId": 1,
      "publicKey": "base64_encoded_prekey",
      "signature": "base64_encoded_signature"
    },
    "preKey": {
      "keyId": 1,
      "publicKey": "base64_encoded_prekey"
    },
    "signingPubKey": "base64_encoded_signing_pubkey"
  }
}
```

---

### 2.2 批量获取用户公钥
```
POST /api/users/keys/batch
```

**请求头：**
```
token: <JWT token>
```

**请求体：**
```json
{
  "userIds": ["user_001", "user_002", "user_003"]
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "users": [
      {
        "userId": "user_001",
        "identityKey": "base64...",
        "signedPreKey": {...},
        "preKey": {...},
        "signingPubKey": "base64..."
      }
    ]
  }
}
```

---

## 3. 一对一消息

> **说明**：服务器仅作为加密消息的中转站，不存储消息明文。消息送达后从服务器删除，历史记录由客户端本地存储（IndexedDB）。

### 3.1 发送一对一消息（离线存储）
```
POST /api/p2p/messages/send
```

**请求头：**
```
token: <JWT token>
```

**请求体：**
```json
{
  "id": "msg_1234567890_abc123",
  "senderId": "user_001",
  "recipientId": "user_002",
  "encryptedContent": "{\"type\":1,\"body\":\"base64...\",\"registrationId\":12345}",
  "messageType": "text",
  "timestamp": 1704067200000,
  "metadata": {
    "fileId": "file_xxx",
    "fileName": "document.pdf",
    "fileSize": 1024000
  }
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "消息发送成功",
  "data": {
    "success": true,
    "messageId": "msg_1234567890_abc123",
    "serverTimestamp": 1704067201000
  }
}
```

---

### 3.2 获取离线消息
```
GET /api/p2p/messages/offline
```

**说明**：获取当前用户的所有离线消息（对方发送但用户未接收的消息）

**请求头：**
```
token: <JWT token>
```

**查询参数：**
- `since` (可选): 时间戳，获取此时间之后的消息

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "success": true,
    "messages": [
      {
        "id": "msg_xxx",
        "senderId": "user_002",
        "recipientId": "user_001",
        "encryptedContent": "{...}",
        "messageType": "text",
        "timestamp": 1704067200000,
        "metadata": {}
      }
    ]
  }
}
```

---

### 3.3 更新消息状态
```
PUT /api/p2p/messages/:messageId/status
```

**说明**：更新消息送达状态，服务器可据此删除已送达的离线消息

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `messageId`: 消息ID

**请求体：**
```json
{
  "status": "delivered"
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "状态更新成功",
  "data": {
    "success": true,
    "messageId": "msg_xxx",
    "status": "delivered"
  }
}
```

---

### 3.4 批量标记消息为已读
```
POST /api/p2p/messages/mark-read
```

**说明**：批量标记消息状态，通知发送方消息已读

**请求头：**
```
token: <JWT token>
```

**请求体：**
```json
{
  "messageIds": ["msg_001", "msg_002", "msg_003"]
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "标记成功",
  "data": {
    "success": true,
    "count": 3
  }
}
```

---

## 4. 群组管理

### 4.1 创建群组
```
POST /api/groups/create
```

**请求头：**
```
token: <JWT token>
```

**请求体：**
```json
{
  "groupId": "group_001",
  "memberIds": ["user_001", "user_002", "user_003"]
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "群组创建成功",
  "data": {
    "success": true,
    "groupId": "group_001",
    "adminId": "user_001",
    "memberIds": ["user_001", "user_002", "user_003"],
    "createdAt": 1704067200000
  }
}
```

---

### 4.2 添加群组成员
```
POST /api/groups/:groupId/members/add
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `groupId`: 群组ID

**请求体：**
```json
{
  "userId": "user_004"
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "成员添加成功",
  "data": {
    "success": true,
    "groupId": "group_001",
    "userId": "user_004"
  }
}
```

---

### 4.3 移除群组成员
```
POST /api/groups/:groupId/members/remove
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `groupId`: 群组ID

**请求体：**
```json
{
  "userId": "user_004"
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "成员移除成功",
  "data": {
    "success": true,
    "groupId": "group_001",
    "userId": "user_004"
  }
}
```

---

### 4.4 获取群组信息
```
GET /api/groups/:groupId
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `groupId`: 群组ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "groupId": "group_001",
    "adminId": "user_001",
    "memberIds": ["user_001", "user_002", "user_003"],
    "createdAt": 1704067200000
  }
}
```

---

## 5. 群组消息

> **说明**：群组消息同样使用端到端加密（Sender Key），服务器仅中转，不存储明文。

### 5.1 分发群组密钥
```
POST /api/groups/keys/distribute
```

**请求头：**
```
token: <JWT token>
```

**请求体：**
```json
{
  "id": "dist_msg_xxx",
  "groupId": "group_001",
  "senderId": "user_001",
  "distributionMessage": "{\"senderKeyId\":123,\"iteration\":0,\"chainKey\":\"base64...\",\"signingPublicKey\":\"base64...\",\"senderId\":\"user_001\"}",
  "timestamp": 1704067200000
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "密钥分发成功",
  "data": {
    "success": true
  }
}
```

---

### 5.2 获取群组密钥分发消息
```
GET /api/groups/:groupId/keys
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `groupId`: 群组ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "success": true,
    "distributions": [
      {
        "id": "dist_msg_xxx",
        "groupId": "group_001",
        "senderId": "user_001",
        "distributionMessage": "{...}",
        "timestamp": 1704067200000
      }
    ]
  }
}
```

---

### 5.3 发送群组消息
```
POST /api/groups/messages/send
```

**请求头：**
```
token: <JWT token>
```

**请求体：**
```json
{
  "id": "msg_xxx",
  "groupId": "group_001",
  "senderId": "user_001",
  "encryptedContent": "{\"senderKeyId\":123,\"iteration\":5,\"ciphertext\":\"base64...\",\"signature\":\"base64...\"}",
  "messageType": "text",
  "timestamp": 1704067200000,
  "metadata": {
    "fileId": "file_xxx"
  }
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "消息发送成功",
  "data": {
    "success": true,
    "messageId": "msg_xxx",
    "serverTimestamp": 1704067201000
  }
}
```

---

### 5.4 获取群组离线消息
```
GET /api/groups/:groupId/messages/offline
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `groupId`: 群组ID

**查询参数：**
- `since` (可选): 时间戳，获取此时间之后的消息

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "success": true,
    "messages": [
      {
        "id": "msg_xxx",
        "groupId": "group_001",
        "senderId": "user_002",
        "encryptedContent": "{...}",
        "messageType": "text",
        "timestamp": 1704067200000,
        "metadata": {}
      }
    ]
  }
}
```

---

## 6. 文件服务

> **说明**：文件在客户端加密后上传，服务器存储加密文件。密钥通过消息传递给接收方。

### 6.1 上传加密文件
```
POST /api/files/upload
```

**请求头：**
```
token: <JWT token>
Content-Type: multipart/form-data
```

**请求体：**
```
file: <加密文件二进制数据>
fileId: file_1234567890_abc123
userId: user_001
metadata: {"originalName": "document.pdf", "mimeType": "application/pdf"}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "上传成功",
  "data": {
    "success": true,
    "downloadUrl": "https://cdn.example.com/files/file_1234567890_abc123.encrypted",
    "fileId": "file_1234567890_abc123"
  }
}
```

**错误响应：**
```json
{
  "code": 0,
  "msg": "文件过大，最大支持100MB",
  "data": null
}
```

---

### 6.2 下载加密文件
```
GET /api/files/download/:fileId
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `fileId`: 文件ID

**成功响应：**
- Content-Type: `application/octet-stream`
- Body: 加密文件的二进制数据

**错误响应：**
```json
{
  "code": 0,
  "msg": "文件不存在或已过期",
  "data": null
}
```

---

### 6.3 获取文件元数据
```
GET /api/files/:fileId/metadata
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `fileId`: 文件ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "fileId": "file_xxx",
    "uploaderId": "user_001",
    "fileSize": 1024000,
    "uploadedAt": 1704067200000,
    "expiresAt": 1706659200000,
    "metadata": {
      "originalName": "document.pdf",
      "mimeType": "application/pdf"
    }
  }
}
```

---

## 7. WebSocket 连接

### 7.1 建立 WebSocket 连接
```
WS /ws?userId={userId}&token={token}
```

**查询参数：**
- `userId`: 用户ID
- `token`: JWT token

**连接成功后，服务器发送：**
```json
{
  "type": "connected",
  "data": {
    "userId": "user_001",
    "timestamp": 1704067200000
  }
}
```

---

### 7.2 客户端 → 服务器消息格式

**发送一对一消息：**
```json
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
```

**发送群组消息：**
```json
{
  "type": "group_message",
  "data": {
    "id": "msg_xxx",
    "groupId": "group_001",
    "encryptedContent": "{...}",
    "messageType": "text",
    "timestamp": 1704067200000
  }
}
```

**心跳：**
```json
{
  "type": "ping",
  "timestamp": 1704067200000
}
```

---

### 7.3 服务器 → 客户端消息格式

**接收一对一消息：**
```json
{
  "type": "message",
  "data": {
    "id": "msg_xxx",
    "senderId": "user_002",
    "encryptedContent": "{...}",
    "messageType": "text",
    "timestamp": 1704067200000,
    "serverTimestamp": 1704067201000
  }
}
```

**接收群组消息：**
```json
{
  "type": "group_message",
  "data": {
    "id": "msg_xxx",
    "groupId": "group_001",
    "senderId": "user_002",
    "encryptedContent": "{...}",
    "messageType": "text",
    "timestamp": 1704067200000,
    "serverTimestamp": 1704067201000
  }
}
```

**密钥分发通知：**
```json
{
  "type": "key_distribution",
  "data": {
    "groupId": "group_001",
    "senderId": "user_002",
    "distributionMessage": "{...}"
  }
}
```

**群组创建通知：**
```json
{
  "type": "group_created",
  "data": {
    "groupId": "group_001",
    "adminId": "user_001",
    "memberIds": ["user_001", "user_002", "user_003"]
  }
}
```

**心跳响应：**
```json
{
  "type": "pong",
  "timestamp": 1704067200000
}
```

---

## 8. 订单管理

> **说明**：订单由后端业务系统创建，前端仅获取和展示订单信息。订单是磋商会话的载体。

### 8.1 获取我的订单列表
```
GET /api/orders/my-orders
```

**请求头：**
```
token: <JWT token>
```

**查询参数：**
- `status` (可选): 订单状态筛选 (negotiating/contract_signing/completed/cancelled)
- `page` (可选): 页码，默认1
- `pageSize` (可选): 每页数量，默认20

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "orders": [
      {
        "id": "order_001",
        "title": "购买iPhone 15 Pro Max 256GB",
        "orderNo": "ORD20250101001",
        "buyerId": "user_001",
        "sellerId": "user_002",
        "participants": [
          {
            "userId": "user_001",
            "userName": "张三",
            "role": "buyer",
            "creditScore": 950
          },
          {
            "userId": "user_002",
            "userName": "李四",
            "role": "seller",
            "creditScore": 920
          }
        ],
        "goods": {
          "id": "goods_001",
          "name": "iPhone 15 Pro Max",
          "description": "全新未拆封，深空黑，256GB",
          "quantity": 1,
          "unit": "台",
          "price": 9999,
          "images": []
        },
        "amount": 9999,
        "currency": "CNY",
        "status": "negotiating",
        "conversationId": "conv_p2p_001",
        "conversationType": "p2p",
        "contractIds": [],
        "createdAt": 1704067200000,
        "updatedAt": 1704067200000,
        "metadata": {
          "lastMessageTime": 1704067200000,
          "lastMessageContent": "好的，我晚上8点前给你发货",
          "unreadCount": 2
        }
      }
    ],
    "total": 10,
    "page": 1,
    "pageSize": 20
  }
}
```

---

### 8.2 获取订单详情
```
GET /api/orders/:orderId
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `orderId`: 订单ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "id": "order_001",
    "title": "购买iPhone 15 Pro Max 256GB",
    "orderNo": "ORD20250101001",
    "buyerId": "user_001",
    "sellerId": "user_002",
    "participants": [
      {
        "userId": "user_001",
        "userName": "张三",
        "role": "buyer",
        "creditScore": 950
      },
      {
        "userId": "user_002",
        "userName": "李四",
        "role": "seller",
        "creditScore": 920
      }
    ],
    "goods": {
      "id": "goods_001",
      "name": "iPhone 15 Pro Max",
      "description": "全新未拆封，深空黑，256GB",
      "quantity": 1,
      "unit": "台",
      "price": 9999,
      "images": ["https://cdn.example.com/goods/img1.jpg"]
    },
    "amount": 9999,
    "currency": "CNY",
    "status": "negotiating",
    "conversationId": "conv_p2p_001",
    "conversationType": "p2p",
    "contractIds": ["contract_001"],
    "createdAt": 1704067200000,
    "updatedAt": 1704067200000,
    "completedAt": null,
    "cancelledAt": null,
    "metadata": {
      "deliveryMethod": "express",
      "paymentMethod": "alipay"
    }
  }
}
```

---

### 8.3 获取订单未读消息数
```
GET /api/orders/:orderId/unread-count
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `orderId`: 订单ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "orderId": "order_001",
    "unreadCount": 5,
    "lastMessageTime": 1704067200000
  }
}
```

---

## 9. 合同管理

> **说明**：合同是磋商达成一致后的签署文档，支持多方顺序签署。合同文件在客户端加密后上传。

### 9.1 创建合同
```
POST /api/contracts/create
```

**请求头：**
```
token: <JWT token>
```

**请求体：**
```json
{
  "orderId": "order_001",
  "title": "iPhone购销合同",
  "content": "合同正文内容...",
  "fileId": "file_contract_001",
  "fileHash": "sha256_hash_of_encrypted_file",
  "participants": [
    {
      "userId": "user_001",
      "role": "buyer",
      "signatureOrder": 1
    },
    {
      "userId": "user_002",
      "role": "seller",
      "signatureOrder": 2
    }
  ],
  "expiresAt": 1704153600000
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "合同创建成功",
  "data": {
    "id": "contract_001",
    "orderId": "order_001",
    "title": "iPhone购销合同",
    "fileHash": "sha256_hash_of_file",
    "status": "pending_signatures",
    "currentSignerIndex": 0,
    "createdAt": 1704067200000
  }
}
```

---

### 9.2 获取合同详情
```
GET /api/contracts/:contractId
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `contractId`: 合同ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "id": "contract_001",
    "orderId": "order_001",
    "conversationId": "conv_p2p_001",
    "conversationType": "p2p",
    "title": "iPhone购销合同",
    "content": "合同正文...",
    "fileId": "file_contract_001",
    "fileHash": "sha256_hash",
    "participants": [
      {
        "userId": "user_001",
        "userName": "张三",
        "role": "buyer",
        "creditScore": 950,
        "signatureOrder": 1,
        "hasSigned": true,
        "signatureRecord": {
          "signerId": "user_001",
          "signerName": "张三",
          "signature": "base64_signature",
          "signedAt": 1704067300000,
          "ipAddress": "192.168.1.100",
          "deviceInfo": "Chrome/120.0"
        }
      },
      {
        "userId": "user_002",
        "userName": "李四",
        "role": "seller",
        "creditScore": 920,
        "signatureOrder": 2,
        "hasSigned": false
      }
    ],
    "currentSignerIndex": 1,
    "status": "signing",
    "createdBy": "user_001",
    "createdAt": 1704067200000,
    "lastModifiedAt": 1704067300000,
    "completedAt": null,
    "expiresAt": 1704153600000
  }
}
```

---

### 9.3 签署合同
```
POST /api/contracts/:contractId/sign
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `contractId`: 合同ID

**请求体：**
```json
{
  "signature": "base64_encoded_signature",
  "signerPublicKey": "base64_encoded_public_key",
  "timestamp": 1704067400000,
  "ipAddress": "192.168.1.101",
  "deviceInfo": "Chrome/120.0"
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "签署成功",
  "data": {
    "success": true,
    "contractId": "contract_001",
    "signerId": "user_002",
    "isCompleted": true,
    "status": "completed",
    "signedAt": 1704067400000
  }
}
```

---

### 9.4 获取订单的合同列表
```
GET /api/contracts/by-order/:orderId
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `orderId`: 订单ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "contracts": [
      {
        "id": "contract_001",
        "title": "iPhone购销合同",
        "status": "completed",
        "participants": [
          {
            "userId": "user_001",
            "hasSigned": true
          },
          {
            "userId": "user_002",
            "hasSigned": true
          }
        ],
        "createdAt": 1704067200000,
        "completedAt": 1704067400000
      }
    ]
  }
}
```

---

### 9.5 验证合同签名
```
POST /api/contracts/:contractId/verify
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `contractId`: 合同ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "验证完成",
  "data": {
    "isValid": true,
    "fileIntegrity": true,
    "signatureResults": [
      {
        "signerId": "user_001",
        "signerName": "张三",
        "isValid": true,
        "signedAt": 1704067300000
      },
      {
        "signerId": "user_002",
        "signerName": "李四",
        "isValid": true,
        "signedAt": 1704067400000
      }
    ],
    "verifiedAt": 1704067500000
  }
}
```

---

## 10. 用户信息

### 10.1 获取用户信息
```
GET /api/users/:userId/profile
```

**请求头：**
```
token: <JWT token>
```

**路径参数：**
- `userId`: 用户ID

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "id": "user_001",
    "openid": "openid_123",
    "userName": "张三",
    "avatar": "https://cdn.example.com/avatars/user_001.jpg",
    "creditScore": 950,
    "registeredAt": 1700000000000,
    "stats": {
      "totalOrders": 25,
      "completedOrders": 23,
      "rating": 4.8
    }
  }
}
```

---

### 10.2 批量获取用户信息
```
POST /api/users/profiles/batch
```

**请求头：**
```
token: <JWT token>
```

**请求体：**
```json
{
  "userIds": ["user_001", "user_002", "user_003"]
}
```

**成功响应：**
```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "users": [
      {
        "id": "user_001",
        "userName": "张三",
        "avatar": "avatar_url",
        "creditScore": 950
      },
      {
        "id": "user_002",
        "userName": "李四",
        "avatar": "avatar_url",
        "creditScore": 920
      }
    ]
  }
}
```

---

## 11. 数据持久化要求

### 11.1 消息保留策略
- **离线消息保留期**：7天（未送达的加密消息）
- **消息送达后**：立即从服务器删除
- **历史消息**：由客户端本地存储（IndexedDB）

### 11.2 文件保留策略
- **加密文件保留期**：30天
- **文件下载统计**：记录下载次数，0次下载的文件优先清理
- **最大文件大小**：100MB

### 11.3 群组密钥分发消息
- **最新分发消息**：永久保留
- **历史分发消息**：成员变更时保留30天

---

## 12. 安全要求

### 12.1 速率限制
- 登录接口：**5次/小时/IP**
- 消息发送：**100条/分钟/用户**
- 文件上传：**10次/小时/用户**
- 公钥查询：**50次/分钟/用户**

### 12.2 Token 有效期
- Access Token：**30分钟**
- 建议实现 Refresh Token 机制

### 12.3 敏感操作验证
- 移除群组成员：需验证操作者为群组管理员
- 下载文件：需验证是否为消息参与方
- 签署合同：需验证签署顺序和参与者身份

---

## 13. 错误处理示例

### 认证失败
```json
{
  "code": 0,
  "msg": "Token无效或已过期，请重新登录",
  "data": null
}
```

### 权限不足
```json
{
  "code": 0,
  "msg": "您没有权限执行此操作",
  "data": null
}
```

### 参数错误
```json
{
  "code": 0,
  "msg": "参数错误：groupId不能为空",
  "data": null
}
```

### 服务器错误
```json
{
  "code": 0,
  "msg": "服务器内部错误，请稍后重试",
  "data": null
}
```

---

## 14. 开发优先级建议

### 第一阶段（必须）- 核心功能
1. 认证接口（1.1, 1.2, 1.3）
2. 用户公钥管理（2.1, 2.2）
3. 订单接口（8.1, 8.2）
4. WebSocket 连接（7.1-7.3）
5. 一对一消息（3.1, 3.2）

### 第二阶段（重要）- 完整聊天
6. 群组管理（4.1-4.4）
7. 群组密钥分发（5.1, 5.2）
8. 群组消息（5.3, 5.4）
9. 用户信息（10.1, 10.2）

### 第三阶段（增强）- 合同与文件
10. 文件服务（6.1, 6.2, 6.3）
11. 合同管理（9.1-9.5）
12. 消息状态更新（3.3, 3.4）

---

这份API文档基于实际的端到端加密架构设计，服务器仅作为消息中转和离线存储，不存储明文内容。所有历史记录由客户端本地管理。