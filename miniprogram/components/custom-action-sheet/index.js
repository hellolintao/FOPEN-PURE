Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer: function(newVal) {
        if (newVal) {
          this.setData({ visible: true });
        } else {
          this.setData({ visible: false });
        }
      }
    },
    itemList: {
      type: Array,
      value: []
    },
    title: {
      type: String,
      value: ''
    }
  },

  data: {
    visible: false
  },

  methods: {
    onItemTap(e) {
      const index = e.currentTarget.dataset.index;
      this.triggerEvent('select', { index });
      this.triggerEvent('close');
    },

    onClose() {
      this.triggerEvent('close');
    },

    onMaskTap() {
      this.triggerEvent('close');
    }
  }
});
