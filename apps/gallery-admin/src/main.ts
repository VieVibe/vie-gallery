import { createApp, watch } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { useAuth } from './composables/useAuth'
import { spaceRequest, type PrivateSpaceAccess } from './lib/privateSpace'
import './styles.css'
import './styles/animations.css'
import './styles/buttons.css'

const router = createRouter({
  history: createWebHistory('/app/'),
  routes: [
    {
      path: '/private-space',
      name: 'private-space',
      component: () => import('./views/PrivateSpaceView.vue')
    },
    {
      path: '/',
      name: 'overview',
      component: () => import('./views/OverviewView.vue')
    },
    {
      path: '/galleries/:id',
      name: 'gallery-workspace',
      component: () => import('./views/GalleryWorkspaceView.vue')
    },
    {
      path: '/members',
      name: 'members',
      component: () => import('./views/MembersView.vue')
    },
    {
      path: '/galleries/:id/config',
      name: 'gallery-config',
      component: () => import('./views/GalleryConfigPanel.vue')
    },
    {
      path: '/reset-password',
      redirect: { name: 'overview', query: {}, hash: '' }
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]
})

const auth = useAuth()
watch([() => router.currentRoute.value.name, auth.currentUser], ([name, user]) => {
  const pageTitle = name === 'overview' ? (user ? '我的相册' : '登录')
    : name === 'private-space' ? '私人空间'
    : name === 'members' ? '成员管理'
    : name === 'gallery-workspace' ? '编辑相册'
    : name === 'gallery-config' ? '展示设计' : ''
  document.title = pageTitle ? `${pageTitle} · 阳光明媚` : '阳光明媚'
}, { immediate: true })

router.beforeEach(async (to) => {
  const auth = useAuth()
  if (!auth.authChecked.value) await auth.checkAuth()
  if (to.name !== 'overview' && !auth.isAuthenticated.value) {
    return { name: 'overview' }
  }
  if (to.name === 'overview' && auth.isAuthenticated.value) {
    try {
      const access = await spaceRequest<PrivateSpaceAccess>('/access')
      if (access.allowed) return { name: 'private-space' }
    } catch { /* Existing gallery accounts remain usable if the optional feature is unavailable. */ }
  }
  if (to.name === 'members' && !auth.isOwner.value) {
    return { name: 'overview' }
  }
  return true
})

createApp(App).use(router).mount('#app')
