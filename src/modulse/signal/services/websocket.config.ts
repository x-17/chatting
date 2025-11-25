
/**
 * WebSocket 配置
 */
export interface WebSocketConfig {
    // 心跳配置
    heartbeat: {
        enabled: boolean;           // 是否启用客户端主动心跳
        interval: number;           // 心跳间隔（毫秒）
        pongTimeout: number;        // 等待 pong 超时时间（毫秒）
    };

    // 重连配置
    reconnect: {
        maxAttempts: number;        // 最大重连次数
        initialDelay: number;       // 初始重连延迟（毫秒）
        maxDelay: number;           // 最大重连延迟（毫秒）
    };

    // ACK 配置
    ack: {
        enabled: boolean;           // 是否启用 ACK 确认
        timeout: number;            // ACK 超时时间（毫秒）
        retry: {
            enabled: boolean;
            maxAttempts: number;
            backoffMultiplier: number;
        };
    };
}

/**
 * 默认配置
 */
export const DEFAULT_WEBSOCKET_CONFIG: WebSocketConfig = {
    heartbeat: {
        enabled: true,              // ✅ 启用客户端主动心跳
        interval: 30000,            // 30 秒发送一次 ping
        pongTimeout: 10000,         // 10 秒内必须收到 pong
    },
    reconnect: {
        maxAttempts: 5,
        initialDelay: 1000,
        maxDelay: 30000,
    },
    ack: {
        enabled: true,
        timeout: 10000,
        retry: {
            enabled: true,           // ✅ 启用重传
            maxAttempts: 3,          // ✅ 最大重试次数
            backoffMultiplier: 2     // ✅ 退避乘数
        }
    },
};

/**
 * 被动模式配置（仅响应服务器 ping）
 */
export const PASSIVE_WEBSOCKET_CONFIG: WebSocketConfig = {
    heartbeat: {
        enabled: false,             // ❌ 禁用客户端主动心跳
        interval: 30000,
        pongTimeout: 10000,
    },
    reconnect: {
        maxAttempts: 5,
        initialDelay: 1000,
        maxDelay: 30000,
    },
    ack: {
        enabled: true,
        timeout: 10000,
        retry: {
            enabled: true,           // ✅ 启用重传
            maxAttempts: 3,          // ✅ 最大重试次数
            backoffMultiplier: 2     // ✅ 退避乘数
        }
    },
};

/**
 * 使用示例：
 *
 * // 使用主动心跳（推荐）
 * const wsManager = new WebSocketManager(userId, wsUrl, DEFAULT_WEBSOCKET_CONFIG);
 *
 * // 使用被动心跳（仅响应服务器）
 * const wsManager = new WebSocketManager(userId, wsUrl, PASSIVE_WEBSOCKET_CONFIG);
 *
 * // 自定义配置
 * const customConfig: WebSocketConfig = {
 *     heartbeat: {
 *         enabled: true,
 *         interval: 60000,     // 60 秒
 *         pongTimeout: 15000,  // 15 秒
 *     },
 *     reconnect: {
 *         maxAttempts: 10,
 *         initialDelay: 2000,
 *         maxDelay: 60000,
 *     },
 *     ack: {
 *         enabled: true,
 *         timeout: 15000,
 *     },
 * };
 */