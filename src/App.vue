<script setup lang="ts"></script>

<template>
  <router-view v-slot="{ Component }">
    <transition name="scale" mode="out-in">
      <keep-alive include="ChatMainView">
        <component :is="Component" />
      </keep-alive>
    </transition>
  </router-view>
</template>

<style scoped></style>
