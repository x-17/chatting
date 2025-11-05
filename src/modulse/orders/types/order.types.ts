// orders/types/order.types.ts

//TODO:尚未完善定义
//export type OrderType = 'purchase' | 'sale';

export type OrderStatus =
    | 'pending'      // 待确认
    | 'active'       // 进行中（磋商中）
    | 'completed'    // 已完成
    | 'cancelled'    // 已取消
    | 'disputed';    // 有争议

export interface OrderParticipant {
    userId: string;
    userName: string;
    role: 'buyer' | 'seller';
    creditScore: number;
}

export interface OrderGoods {
    id: string;
    name: string;
    description?: string;
    quantity: number;
    unit: string;
    price: number;
    images?: string[];
}

export interface Order {
    id: string;
    title: string;                    // 订单标题
    orderNo: string;                  // 订单编号

    // 参与方
    buyerId: string;
    sellerId: string;
    participants: OrderParticipant[];

    // 商品信息
    goods: OrderGoods;

    // 金额
    amount: number;
    currency: string;

    // 状态
    status: OrderStatus;

    // 会话信息
    conversationId: string;
    conversationType: 'p2p' | 'group';

    // 时间
    createdAt: number;
    updatedAt: number;
    completedAt?: number;

    // 合同
    contractIds?: string[];

    // 元数据
    metadata?: {
        lastMessageTime?: number;
        lastMessageContent?: string;
        unreadCount?: number;
        [key: string]: any;
    };
}

// 创建订单的请求参数
export interface CreateOrderRequest {
    title: string;
    sellerId: string;
    goods: OrderGoods;
    amount: number;
    currency?: string;
}