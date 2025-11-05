// src/mock/mock-data.ts

import type { Order } from '../orders/types/order.types';
import type { P2PMessage } from '../signal/types/message.types';
import type { GroupMessage } from '../groupchat/types/group-message.types';
import type { Contract } from '../contracts/types/contract.types';

// 当前用户ID
export const MOCK_CURRENT_USER_ID = 'user_alice';

// 模拟用户数据
export const mockUsers = {
    user_alice: {
        id: 'user_alice',
        userName: '张小美',
        email: 'alice@example.com',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice'
    },
    user_bob: {
        id: 'user_bob',
        userName: '李大壮',
        email: 'bob@example.com',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Bob'
    },
    user_charlie: {
        id: 'user_charlie',
        userName: '王小明',
        email: 'charlie@example.com',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie'
    },
    user_david: {
        id: 'user_david',
        userName: '赵老板',
        email: 'david@example.com',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=David'
    }
};

// 模拟订单数据
export const mockOrders: Order[] = [
    {
        id: 'order_001',
        title: '购买iPhone 15 Pro Max 256GB',
        orderNo: 'ORD20250101001',
        buyerId: 'user_alice',
        sellerId: 'user_bob',
        participants: [
            {
                userId: 'user_alice',
                userName: '张小美',
                role: 'buyer',
                creditScore: 950
            },
            {
                userId: 'user_bob',
                userName: '李大壮',
                role: 'seller',
                creditScore: 920
            }
        ],
        goods: {
            id: 'goods_001',
            name: 'iPhone 15 Pro Max',
            description: '全新未拆封，深空黑，256GB',
            quantity: 1,
            unit: '台',
            price: 9999,
            images: []
        },
        amount: 9999,
        currency: 'CNY',
        status: 'active',
        conversationId: 'conv_p2p_001',
        conversationType: 'p2p',
        createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 10 * 60 * 1000,
        metadata: {
            lastMessageTime: Date.now() - 10 * 60 * 1000,
            lastMessageContent: '好的，我晚上8点前给你发货',
            unreadCount: 2
        }
    },
    {
        id: 'order_002',
        title: '出售MacBook Pro 2023款',
        orderNo: 'ORD20250102002',
        buyerId: 'user_charlie',
        sellerId: 'user_alice',
        participants: [
            {
                userId: 'user_charlie',
                userName: '王小明',
                role: 'buyer',
                creditScore: 880
            },
            {
                userId: 'user_alice',
                userName: '张小美',
                role: 'seller',
                creditScore: 950
            }
        ],
        goods: {
            id: 'goods_002',
            name: 'MacBook Pro 14" 2023',
            description: 'M3 Pro芯片，18GB内存，512GB存储',
            quantity: 1,
            unit: '台',
            price: 15999,
            images: []
        },
        amount: 15999,
        currency: 'CNY',
        status: 'active',
        conversationId: 'conv_p2p_002',
        conversationType: 'p2p',
        createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 2 * 60 * 60 * 1000,
        metadata: {
            lastMessageTime: Date.now() - 2 * 60 * 60 * 1000,
            lastMessageContent: '可以，我明天去看货',
            unreadCount: 0
        }
    },
    {
        id: 'order_003',
        title: '采购办公设备一批（群组订单）',
        orderNo: 'ORD20250103003',
        buyerId: 'user_alice',
        sellerId: 'user_david',
        participants: [
            {
                userId: 'user_alice',
                userName: '张小美',
                role: 'buyer',
                creditScore: 950
            },
            {
                userId: 'user_david',
                userName: '赵老板',
                role: 'seller',
                creditScore: 970
            },
            {
                userId: 'user_bob',
                userName: '李大壮',
                role: 'other',
                creditScore: 920
            }
        ],
        goods: {
            id: 'goods_003',
            name: '办公设备套装',
            description: '包含显示器、键盘、鼠标等',
            quantity: 10,
            unit: '套',
            price: 2500,
            images: []
        },
        amount: 25000,
        currency: 'CNY',
        status: 'active',
        conversationId: 'group_001',
        conversationType: 'group',
        createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 30 * 60 * 1000,
        metadata: {
            lastMessageTime: Date.now() - 30 * 60 * 1000,
            lastMessageContent: '@张小美 合同我已经准备好了',
            unreadCount: 5
        }
    },
    {
        id: 'order_004',
        title: '购买二手相机',
        orderNo: 'ORD20241225004',
        buyerId: 'user_alice',
        sellerId: 'user_charlie',
        participants: [
            {
                userId: 'user_alice',
                userName: '张小美',
                role: 'buyer',
                creditScore: 950
            },
            {
                userId: 'user_charlie',
                userName: '王小明',
                role: 'seller',
                creditScore: 880
            }
        ],
        goods: {
            id: 'goods_004',
            name: 'Canon EOS R6 Mark II',
            description: '使用3个月，成色99新',
            quantity: 1,
            unit: '台',
            price: 12800,
            images: []
        },
        amount: 12800,
        currency: 'CNY',
        status: 'completed',
        conversationId: 'conv_p2p_004',
        conversationType: 'p2p',
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
        completedAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
        contractIds: ['contract_001'],
        metadata: {
            lastMessageTime: Date.now() - 25 * 24 * 60 * 60 * 1000,
            lastMessageContent: '交易愉快！',
            unreadCount: 0
        }
    }
];

// 模拟P2P消息数据
export const mockP2PMessages: Record<string, P2PMessage[]> = {
    conv_p2p_001: [
        {
            id: 'msg_001',
            type: 'text',
            orderId:"order_001",
            senderId: 'user_alice',
            recipientId: 'user_bob',
            content: '你好，这个iPhone还在吗？',
            timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
            status: 'read'
        },
        {
            id: 'msg_002',
            type: 'text',
            orderId:"order_001",
            senderId: 'user_bob',
            recipientId: 'user_alice',
            content: '在的，全新未拆封，深空黑256GB',
            timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000,
            status: 'read'
        },
        {
            id: 'msg_003',
            type: 'text',
            orderId:"order_001",
            senderId: 'user_alice',
            recipientId: 'user_bob',
            content: '价格可以商量吗？9500可以吗？',
            timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000,
            status: 'read'
        },
        {
            id: 'msg_004',
            type: 'text',
            orderId:"order_001",
            senderId: 'user_bob',
            recipientId: 'user_alice',
            content: '这个价格已经很优惠了，官网要10999呢',
            timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 15 * 60 * 1000,
            status: 'read'
        },
        {
            id: 'msg_005',
            type: 'image',
            orderId:"order_001",
            senderId: 'user_bob',
            recipientId: 'user_alice',
            content: '[图片] 产品实拍图',
            timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000 + 20 * 60 * 1000,
            status: 'read',
            metadata: {
                fileName: 'iphone_photo.jpg',
                fileSize: 2048576,
                mimeType: 'image/jpeg',
                previewUrl: 'https://via.placeholder.com/400x300/409EFF/FFFFFF?text=iPhone+15+Pro'
            }
        },
        {
            id: 'msg_006',
            type: 'text',
            orderId:"order_001",
            senderId: 'user_alice',
            recipientId: 'user_bob',
            content: '看起来不错！那就原价吧，什么时候能发货？',
            timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000,
            status: 'read'
        },
        {
            id: 'msg_007',
            type: 'text',
            orderId:"order_001",
            senderId: 'user_bob',
            recipientId: 'user_alice',
            content: '好的，我晚上8点前给你发货',
            timestamp: Date.now() - 10 * 60 * 1000,
            status: 'delivered'
        }
    ],
    conv_p2p_002: [
        {
            id: 'msg_101',
            type: 'text',
            orderId:"order_002",
            senderId: 'user_charlie',
            recipientId: 'user_alice',
            content: '你好，看到你的MacBook，能看看实物吗？',
            timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000,
            status: 'read'
        },
        {
            id: 'msg_102',
            type: 'text',
            orderId:"order_002",
            senderId: 'user_alice',
            recipientId: 'user_charlie',
            content: '可以啊，你在哪个城市？',
            timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000,
            status: 'read'
        },
        {
            id: 'msg_103',
            type: 'text',
            orderId:"order_002",
            senderId: 'user_charlie',
            recipientId: 'user_alice',
            content: '我在北京朝阳区',
            timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000,
            status: 'read'
        },
        {
            id: 'msg_104',
            type: 'text',
            orderId:"order_002",
            senderId: 'user_alice',
            recipientId: 'user_charlie',
            content: '巧了，我也在朝阳。明天下午3点大悦城见面可以吗？',
            timestamp: Date.now() - 4 * 24 * 60 * 60 * 1000,
            status: 'read'
        },
        {
            id: 'msg_105',
            type: 'text',
            orderId:"order_002",
            senderId: 'user_charlie',
            recipientId: 'user_alice',
            content: '可以，我明天去看货',
            timestamp: Date.now() - 2 * 60 * 60 * 1000,
            status: 'read'
        }
    ]
};

// 模拟群组消息
export const mockGroupMessages: Record<string, GroupMessage[]> = {
    group_001: [
        {
            id: 'gmsg_001',
            type: 'system',
            groupId: 'group_001',
            senderId: 'system',
            content: JSON.stringify({
                type: 'member_joined',
                text: '李大壮 加入了群聊'
            }),
            timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
            status: 'delivered'
        },
        {
            id: 'gmsg_002',
            type: 'text',
            groupId: 'group_001',
            senderId: 'user_alice',
            content: '欢迎李大壮！我们讨论一下办公设备采购的事',
            timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000,
            status: 'delivered'
        },
        {
            id: 'gmsg_003',
            type: 'text',
            groupId: 'group_001',
            senderId: 'user_david',
            content: '我这边可以提供显示器、键盘、鼠标全套，每套2500元',
            timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000,
            status: 'delivered'
        },
        {
            id: 'gmsg_004',
            type: 'file',
            groupId: 'group_001',
            senderId: 'user_david',
            content: '[文件] 产品清单.xlsx',
            timestamp: Date.now() - 6 * 24 * 60 * 60 * 1000 + 10 * 60 * 1000,
            status: 'delivered',
            metadata: {
                fileName: '产品清单.xlsx',
                fileSize: 45632,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
        },
        {
            id: 'gmsg_005',
            type: 'text',
            groupId: 'group_001',
            senderId: 'user_bob',
            content: '价格合理，质量怎么样？',
            timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000,
            status: 'delivered'
        },
        {
            id: 'gmsg_006',
            type: 'text',
            groupId: 'group_001',
            senderId: 'user_david',
            content: '都是一线品牌，保修一年',
            timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000,
            status: 'delivered'
        },
        {
            id: 'gmsg_007',
            type: 'text',
            groupId: 'group_001',
            senderId: 'user_alice',
            content: '那我们可以签合同了',
            timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000,
            status: 'delivered'
        },
        {
            id: 'gmsg_008',
            type: 'text',
            groupId: 'group_001',
            senderId: 'user_david',
            content: '@张小美 合同我已经准备好了',
            timestamp: Date.now() - 30 * 60 * 1000,
            status: 'delivered'
        }
    ]
};

// 模拟合同数据
export const mockContracts: Contract[] = [
    {
        id: 'contract_001',
        orderId: 'order_004',
        conversationId: 'conv_p2p_004',
        conversationType: 'p2p',
        title: '二手相机买卖合同',
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
        fileHash: 'a3f5e8d9c2b1f4e7a6d8c9b0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0',
        participants: [
            {
                userId: 'user_alice',
                userName: '张小美',
                role: 'buyer',
                creditScore: 950,
                signatureOrder: 1,
                hasSigned: true,
                signatureRecord: {
                    signerId: 'user_alice',
                    signerName: '张小美',
                    signature: 'base64_signature_alice',
                    signedAt: Date.now() - 26 * 24 * 60 * 60 * 1000
                }
            },
            {
                userId: 'user_charlie',
                userName: '王小明',
                role: 'seller',
                creditScore: 880,
                signatureOrder: 2,
                hasSigned: true,
                signatureRecord: {
                    signerId: 'user_charlie',
                    signerName: '王小明',
                    signature: 'base64_signature_charlie',
                    signedAt: Date.now() - 25 * 24 * 60 * 60 * 1000
                }
            }
        ],
        currentSignerIndex: 2,
        status: 'completed',
        createdBy: 'user_alice',
        createdAt: Date.now() - 27 * 24 * 60 * 60 * 1000,
        lastModifiedAt: Date.now() - 25 * 24 * 60 * 60 * 1000,
        completedAt: Date.now() - 25 * 24 * 60 * 60 * 1000
    },
    {
        id: 'contract_002',
        orderId: 'order_003',
        conversationId: 'group_001',
        conversationType: 'group',
        title: '办公设备采购合同',
        content: `
采购合同

甲方（买方）：张小美
乙方（卖方）：赵老板

商品：办公设备套装 10套
总价：25000元
交付时间：2025年1月15日
    `,
        fileHash: 'b4e6f9a0d3c2e5f8b7a9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1',
        participants: [
            {
                userId: 'user_david',
                userName: '赵老板',
                role: 'seller',
                creditScore: 970,
                signatureOrder: 1,
                hasSigned: true,
                signatureRecord: {
                    signerId: 'user_david',
                    signerName: '赵老板',
                    signature: 'base64_signature_david',
                    signedAt: Date.now() - 2 * 60 * 60 * 1000
                }
            },
            {
                userId: 'user_alice',
                userName: '张小美',
                role: 'buyer',
                creditScore: 950,
                signatureOrder: 2,
                hasSigned: false
            }
        ],
        currentSignerIndex: 1,
        status: 'signing',
        createdBy: 'user_david',
        createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
        lastModifiedAt: Date.now() - 2 * 60 * 60 * 1000,
        expiresAt: Date.now() + 6 * 24 * 60 * 60 * 1000
    }
];