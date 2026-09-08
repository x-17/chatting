// orders/types/order.types.ts

//TODO:尚未完善定义
//export type OrderType = 'purchase' | 'sale';

export type OrderStatus = 1 | 2 | 3 | 4 | 5; // 1 - 磋商成功, 2 - 磋商失败, 3 - 交付成功, 4 - 待磋商, 5 - 存在异议

export interface OrderParticipant {
  id: number;
  orderId: string;
  userId: number;
  username?: string;
  // userName: string;
  roleType: 0 | 1; // 0 - 买家, 1 - 卖家
  reputationScore: number;
  dataName: string;
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
  id: number;
  orderId: string; // 订单编号
  dataName: string;
  flag: OrderStatus;
  bssOrderId: number;
  orderType: 0 | 1; //0-个人订单，1-_多方订单
  contract: string; //"https://file-server/contract.pdf", 订单关联契约存储url
  //参与方
  participants: OrderParticipant[];
  recommendedSignerTenantId?: number;
  recommendedSignerReputationScore?: number;
  // 元数据
  metadata?: {
    lastMessageTime?: number;
    lastMessageContent?: string;
    unreadCount?: number;
    [key: string]: any;
  };
  parentOrderId: string;
  objectionReason: string;
}

// 创建订单的请求参数
export interface CreateOrderRequest {
  title: string;
  sellerId: string;
  goods: OrderGoods;
  amount: number;
  currency?: string;
}
