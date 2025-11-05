// modulse/chat/router/index.ts

export const chatRoutes = [
    {
        path: '/chat',
        name: 'ChatMain',
        component: () => import('../views/ChatMainView.vue'),
        meta: {
            requiresAuth: true,
            title: '订单磋商',
            // keepAlive: true
        },
    },
    
];