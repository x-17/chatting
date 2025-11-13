// src/mock/mock-data.ts

import type { Order } from "../orders/types/order.types";
import type { P2PMessage } from "../signal/types/message.types";
import type { GroupMessage } from "../groupchat/types/group-message.types";
import type { Contract } from "../contracts/types/contract.types";

// 当前用户ID
export const MOCK_CURRENT_USER_ID = "user_alice";

// 模拟用户数据
export const mockUsers = {
  user_alice: {
    id: "user_alice",
    userName: "张小美",
    email: "alice@example.com",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
  },
  user_bob: {
    id: "user_bob",
    userName: "李大壮",
    email: "bob@example.com",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Bob",
  },
  user_charlie: {
    id: "user_charlie",
    userName: "王小明",
    email: "charlie@example.com",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie",
  },
  user_david: {
    id: "user_david",
    userName: "赵老板",
    email: "david@example.com",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=David",
  },
};

// 模拟订单数据
export const mockOrders: Order[] = [
  {
    id: 1,
    orderId: "ORD20251109001",
    dataName: "企业客户信用评级数据集",
    flag: 4, // 磋商成功
    bssOrderId: 5001,
    orderType: 0, // 个人订单
    contract: "https://file-server/contracts/ord-20251109001.pdf",
    participants: [
      {
        id: 101,
        orderId: "ORD20251109001",
        userId: 10003,
        roleType: 0,
        dataName: "企业客户信用评级数据集",
      }, // 买家
      {
        id: 102,
        orderId: "ORD20251109001",
        userId: 20001,
        roleType: 1,
        dataName: "企业客户信用评级数据集",
      }, // 卖家
    ],
  },
  {
    id: 2,
    orderId: "ORD20251109002",
    dataName: "区域消费趋势分析报告",
    flag: 4, // 磋商失败
    bssOrderId: 5002,
    orderType: 0, // 多方订单
    contract: "https://file-server/contracts/ord-20251109002.pdf",
    participants: [
      {
        id: 201,
        orderId: "ORD20251109002",
        userId: 10002,
        roleType: 0,
        dataName: "区域消费趋势分析报告",
      }, // 买家
      {
        id: 202,
        orderId: "ORD20251109002",
        userId: 20002,
        roleType: 1,
        dataName: "区域消费趋势分析报告",
      }, // 卖家1
    ],
  },
  {
    id: 3,
    orderId: "ORD20251109003",
    dataName: "电商平台用户画像数据",
    flag: 4, // 交付成功
    bssOrderId: 5003,
    orderType: 0, // 个人订单
    contract: "https://file-server/contracts/ord-20251109003.pdf",
    participants: [
      {
        id: 301,
        orderId: "ORD20251109003",
        userId: 10003,
        roleType: 0,
        dataName: "电商平台用户画像数据",
      }, // 买家
      {
        id: 302,
        orderId: "ORD20251109003",
        userId: 20004,
        roleType: 1,
        dataName: "电商平台用户画像数据",
      }, // 卖家
    ],
  },
];

// 模拟P2P消息数据
export const mockP2PMessages: Record<string, P2PMessage[]> = {
  ORD20251109001: [
    // 1. 买家发起询问（最早的消息）
    {
      id: "msg_001",
      type: "text",
      orderId: "ORD20251109001",
      senderId: "10003", // 买家
      recipientId: "user_9002", // 卖家
      content:
        '您好，我想咨询一下"城市交通数据包"的具体数据范围，包含近3年的地铁流量吗？',
      timestamp: 1730505600000, // 2025-11-02 08:00:00
      status: "sent",
      sequence: 1,
      sendAttempts: 1,
      maxRetries: 3,
      retryDelay: 1000,
      deliveryConfirmed: true,
      readConfirmed: false, // 卖家尚未标记已读
    },

    // 2. 卖家回复
    {
      id: "msg_002",
      type: "text",
      orderId: "ORD20251109001",
      senderId: "user_9002", // 卖家
      recipientId: "10003", // 买家
      content:
        "包含的，数据范围是2022-2024年的地铁、公交、共享单车流量，每小时粒度。需要我发一份样本给您吗？",
      encryptedContent: "eyJjb250ZW50Ijoi...", // 模拟加密内容
      timestamp: 1730506500000, // 2025-11-02 08:15:00
      status: "sent",
      sequence: 2,
      sendAttempts: 1,
      maxRetries: 3,
      retryDelay: 1000,
      deliveryConfirmed: true,
      readConfirmed: true, // 买家已读
    },

    // 3. 买家确认需求
    {
      id: "msg_003",
      type: "text",
      orderId: "ORD20251109001",
      senderId: "10003", // 买家
      recipientId: "user_9002", // 卖家
      content: "不用了，符合我的需求。请问合同什么时候可以签署？",
      timestamp: 1730507400000, // 2025-11-02 08:30:00
      status: "sent",
      localId: "local_001", // 本地临时ID（未同步到服务器时使用）
      sequence: 3,
      sendAttempts: 1,
      maxRetries: 3,
      retryDelay: 1000,
      deliveryConfirmed: true,
      readConfirmed: false,
    },

    // 4. 卖家发送合同链接
    {
      id: "msg_004",
      type: "text",
      orderId: "ORD20251109001",
      senderId: "user_9002", // 卖家
      recipientId: "10003", // 买家
      content:
        "合同已生成，链接：https://file-server/contract.pdf ，签署后我会安排数据交付。",
      encryptedContent: "eyJjb250ZW50Ijoi...",
      timestamp: 1730508300000, // 2025-11-02 08:45:00
      status: "sent",
      sequence: 4,
      sendAttempts: 2, // 第一次发送失败，重试1次
      lastAttemptTime: 1730508290000,
      maxRetries: 3,
      retryDelay: 1000,
      deliveryConfirmed: true,
      readConfirmed: true,
    },

    // 5. 买家确认签署（最新的消息）
    {
      id: "msg_005",
      type: "text",
      orderId: "ORD20251109001",
      senderId: "10003", // 买家
      recipientId: "user_9002", // 卖家
      content: "已签署，麻烦尽快安排，谢谢！",
      timestamp: 1730509200000, // 2025-11-02 09:00:00
      status: "sent",
      sequence: 5,
      sendAttempts: 1,
      nextRetryTime: 1730509210000, // 若发送失败，10秒后重试
      maxRetries: 3,
      retryDelay: 1000,
      deliveryConfirmed: false, // 尚未确认送达
      readConfirmed: false,
    },
  ],
  ORD20251109002: [
    {
      id: "msg_101",
      type: "text",
      orderId: "ORD20251109002",
      senderId: "20004", // 买方
      recipientId: "ORD20251109002", // 卖方
      content:
        '您好，我想购买"区域消费行为数据集"，请问数据包含2024年Q4的明细吗？',
      timestamp: 1730764800000, // 2025-11-05 08:00:00
      status: "sent",
      sequence: 1,
      sendAttempts: 1,
      maxRetries: 3,
      retryDelay: 2000,
      deliveryConfirmed: true,
      readConfirmed: false,
    },

    // 2. 卖方（20004）回复
    {
      id: "msg_102",
      type: "text",
      orderId: "ORD20251109002",
      senderId: "ORD20251109002", // 卖方
      recipientId: "10003", // 买方
      content:
        "包含的，2024年Q4的数据已更新。另外支持按区域筛选，需要我发一份字段说明吗？",
      encryptedContent: "f3Kj2l...", // 模拟加密内容
      timestamp: 1730765700000, // 2025-11-05 08:15:00
      status: "sent",
      sequence: 2,
      sendAttempts: 1,
      maxRetries: 3,
      retryDelay: 2000,
      deliveryConfirmed: true,
      readConfirmed: true,
    },

    // 3. 买方（10003）请求文件
    {
      id: "msg_103",
      type: "text",
      orderId: "ORD20251109002",
      senderId: "10003", // 买方
      recipientId: "20004", // 卖方
      content: '{"fileName":"字段说明文档.docx","size":102400}', // 文件元数据JSON
      timestamp: 1730766600000, // 2025-11-05 08:30:00
      status: "sent",
      localId: "local_103",
      sequence: 3,
      sendAttempts: 1,
      maxRetries: 3,
      retryDelay: 2000,
      deliveryConfirmed: true,
      readConfirmed: false,
    },

    // 4. 卖方（20004）发送文件链接（发送重试场景）
    {
      id: "msg_104",
      type: "text",
      orderId: "ORD20251109002",
      senderId: "20004", // 卖方
      recipientId: "10003", // 买方
      content:
        "字段说明：https://file-server/fields.pdf ，如果链接失效可以告诉我",
      encryptedContent: "a7Dk9p...",
      timestamp: 1730767500000, // 2025-11-05 08:45:00
      status: "sent",
      sequence: 4,
      sendAttempts: 2, // 首次发送失败，重试1次
      lastAttemptTime: 1730767490000,
      maxRetries: 3,
      retryDelay: 2000,
      deliveryConfirmed: true,
      readConfirmed: true,
    },

    // 5. 买方（10003）确认购买
    {
      id: "msg_105",
      type: "text",
      orderId: "ORD20251109002",
      senderId: "10003", // 买方
      recipientId: "20004", // 卖方
      content: "文档已查看，符合需求。我这边已发起订单支付，麻烦留意一下~",
      timestamp: 1730768400000, // 2025-11-05 09:00:00
      status: "sent",
      sequence: 5,
      sendAttempts: 1,
      nextRetryTime: 1730768412000, // 12秒后重试（若失败）
      maxRetries: 3,
      retryDelay: 2000,
      deliveryConfirmed: false,
      readConfirmed: false,
    },

    // 6. 卖方（20004）确认收款（最新）
    {
      id: "msg_106",
      type: "text",
      orderId: "ORD20251109002",
      senderId: "20004", // 卖方
      recipientId: "10003", // 买方
      content: "已收到款项，数据将在1小时内通过邮件发送，请注意查收~",
      timestamp: 1730769300000, // 2025-11-05 09:15:00
      status: "sent",
      sequence: 6,
      sendAttempts: 1,
      maxRetries: 3,
      retryDelay: 2000,
      deliveryConfirmed: true,
      readConfirmed: false,
    },
  ],
};

// 模拟群组消息
export const mockGroupMessages: Record<string, GroupMessage[]> = {
  group_001: [
    {
      id: "gmsg_001",
      type: "system",
      groupId: "group_001",
      senderId: "system",
      content: JSON.stringify({
        type: "member_joined",
        text: "李大壮 加入了群聊",
      }),
      timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
      status: "delivered",
    },
    {
      id: "gmsg_002",
      type: "text",
      groupId: "group_001",
      senderId: "user_alice",
      content: "欢迎李大壮！我们讨论一下办公设备采购的事",
      timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000,
      status: "delivered",
    },
    {
      id: "gmsg_003",
      type: "text",
      groupId: "group_001",
      senderId: "user_david",
      content: "我这边可以提供显示器、键盘、鼠标全套，每套2500元",
      timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000,
      status: "delivered",
    },
    {
      id: "gmsg_004",
      type: "file",
      groupId: "group_001",
      senderId: "user_david",
      content: "[文件] 产品清单.xlsx",
      timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000,
      status: "delivered",
      metadata: {
        fileName: "产品清单.xlsx",
        fileSize: 45632,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    },
    {
      id: "gmsg_005",
      type: "text",
      groupId: "group_001",
      senderId: "user_bob",
      content: "价格合理，质量怎么样？",
      timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000,
      status: "delivered",
    },
    {
      id: "gmsg_006",
      type: "text",
      groupId: "group_001",
      senderId: "user_david",
      content: "都是一线品牌，保修一年",
      timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000,
      status: "delivered",
    },
    {
      id: "gmsg_007",
      type: "text",
      groupId: "group_001",
      senderId: "user_alice",
      content: "那我们可以签合同了",
      timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000,
      status: "delivered",
    },
    {
      id: "gmsg_008",
      type: "text",
      groupId: "group_001",
      senderId: "user_david",
      content: "@张小美 合同我已经准备好了",
      timestamp: Date.now() - 30 * 60 * 1000,
      status: "delivered",
    },
  ],
};

// 模拟合同数据
export const mockContracts: Contract[] = [
  {
    id: "contract_001",
    orderId: "order_004",
    conversationId: "conv_p2p_004",
    conversationType: "p2p",
    title: "二手相机买卖合同",
    content: `
买卖合同

甲方（买方）：张小美
身份证号：110101199001011234
联系电话：13800138000

乙方（卖方）：王小明
身份证号：110101199102021234
联系电话：13900139000

一、标的物信息
商品名称：Canon EOS R6 Mark II
商品规格：全画幅微单相机
数量：1 台
单价：12800 元
总价：12800 元

二、交付条款
交付时间：2024年12月26日
交付地点：北京市朝阳区大悦城
运费承担：买方承担

三、付款方式
付款方式：一次性付款
付款时间：交货当日

四、质量标准
产品成色：99新
保修情况：原厂保修剩余8个月
附件：相机包、充电器、说明书

五、违约责任
任何一方违约，应向守约方支付合同总金额20%的违约金

六、争议解决
本合同在履行过程中发生的争议，由双方友好协商解决；
协商不成的，提交合同签订地人民法院诉讼解决。
    `,
    fileHash:
      "a3f5e8d9c2b1f4e7a6d8c9b0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0",
    participants: [
      {
        userId: "user_alice",
        userName: "张小美",
        role: "buyer",
        creditScore: 950,
        signatureOrder: 1,
        hasSigned: true,
        signatureRecord: {
          signerId: "user_alice",
          signerName: "张小美",
          signature: "base64_signature_alice",
          signedAt: Date.now() - 26 * 24 * 60 * 60 * 1000,
        },
      },
      {
        userId: "user_charlie",
        userName: "王小明",
        role: "seller",
        creditScore: 880,
        signatureOrder: 2,
        hasSigned: true,
        signatureRecord: {
          signerId: "user_charlie",
          signerName: "王小明",
          signature: "base64_signature_charlie",
          signedAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
        },
      },
    ],
    currentSignerIndex: 2,
    status: "completed",
    createdBy: "user_alice",
    createdAt: Date.now() - 27 * 24 * 60 * 60 * 1000,
    lastModifiedAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
    completedAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
  },
  {
    id: "contract_002",
    orderId: "order_003",
    conversationId: "group_001",
    conversationType: "group",
    title: "办公设备采购合同",
    content: `
采购合同

甲方（买方）：张小美
乙方（卖方）：赵老板

商品：办公设备套装 10套
总价：25000元
交付时间：2025年1月15日
    `,
    fileHash:
      "b4e6f9a0d3c2e5f8b7a9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
    participants: [
      {
        userId: "user_david",
        userName: "赵老板",
        role: "seller",
        creditScore: 970,
        signatureOrder: 1,
        hasSigned: true,
        signatureRecord: {
          signerId: "user_david",
          signerName: "赵老板",
          signature: "base64_signature_david",
          signedAt: Date.now() - 2 * 60 * 60 * 1000,
        },
      },
      {
        userId: "user_alice",
        userName: "张小美",
        role: "buyer",
        creditScore: 950,
        signatureOrder: 2,
        hasSigned: false,
      },
    ],
    currentSignerIndex: 1,
    status: "signing",
    createdBy: "user_david",
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
    lastModifiedAt: Date.now() - 2 * 60 * 60 * 1000,
    expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000,
  },
];
