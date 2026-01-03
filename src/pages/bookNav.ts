export function initBookNav(): void {
  const content = document.querySelector('.book-page');
  const navList = document.getElementById('book-nav-list');

  if (!content || !navList) return;

  const h2Elements = content.querySelectorAll('h2');

  h2Elements.forEach((h2) => {
    let id = h2.id;
    if (!id) {
      id = h2.textContent?.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || '';
      h2.id = id;
    }

    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + id;
    a.className = 'nav-link';
    a.textContent = h2.textContent;
    li.appendChild(a);
    navList.appendChild(li);
  });

  const navLinks = document.querySelectorAll<HTMLAnchorElement>('.book-nav .nav-link');

  function setActiveLink(): void {
    let currentSection = '';
    const h2Array = Array.from(h2Elements);

    h2Array.forEach((h2, index) => {
      const sectionTop = h2.offsetTop - 100;
      const nextH2 = h2Array[index + 1];
      const sectionBottom = nextH2 ? nextH2.offsetTop : document.body.scrollHeight;

      if (window.scrollY >= sectionTop && window.scrollY < sectionBottom) {
        currentSection = h2.id;
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === '#' + currentSection) {
        link.classList.add('active');
      }
    });
  }

  window.addEventListener('scroll', setActiveLink);
  setActiveLink();

  navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const targetId = this.getAttribute('href')?.substring(1);
      if (!targetId) return;

      const targetSection = document.getElementById(targetId);
      if (targetSection) {
        window.scrollTo({
          top: targetSection.offsetTop - 100,
          behavior: 'smooth'
        });
      }
    });
  });
}
