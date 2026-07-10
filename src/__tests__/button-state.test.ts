/**
 * @jest-environment jsdom
 */
// Verify button state detection works synchronously via DOM
import { App, Vault, MetadataCache, FileManager } from 'obsidian';
import { NoteService } from '../services/note-service';

test('should_detect_generated_sections_via_dom', () => {
  const app = new App();
  const ns = new NoteService(app, '📚图书库');

  // Simulate rendered markdown
  const container = document.createElement('div');

  // Add the inline buttons (as they appear in note content)
  const btnDiv = document.createElement('div');
  btnDiv.innerHTML = `
    <a href="ai-book://summary" class="ai-book-link">📝 生成简介</a> |
    <a href="ai-book://toc" class="ai-book-link">📋 生成目录</a>
  `;
  container.appendChild(btnDiv);

  // Scenario 1: No sections generated — buttons should stay as "生成"
  ns.updateButtonStates(container, 'test/path.md');
  let links = container.querySelectorAll('.ai-book-link');
  expect(links[0].textContent).toBe('📝 生成简介');
  expect(links[1].textContent).toBe('📋 生成目录');

  // Scenario 2: Summary was generated — DOM now has the h2
  const h2 = document.createElement('h2');
  h2.textContent = '📝 书籍简介';
  container.appendChild(h2);

  ns.updateButtonStates(container, 'test/path.md');
  links = container.querySelectorAll('.ai-book-link');
  expect(links[0].textContent).toBe('🔄 重新生成简介');  // Should change!
  expect(links[1].textContent).toBe('📋 生成目录');       // Still not generated

  // Scenario 3: TOC was generated — check chapter links too
  const tocH2 = document.createElement('h2');
  tocH2.textContent = '📋 本书目录';
  container.appendChild(tocH2);

  const tocList = document.createElement('ul');
  tocList.innerHTML = `
    <li>第1章：科学边界 <a href="ai-book://chapter-overview" data-chapter="第1章：科学边界" class="ai-toc-link">📝 生成概要</a></li>
  `;
  container.appendChild(tocList);

  ns.updateButtonStates(container, 'test/path.md');
  links = container.querySelectorAll('.ai-book-link');
  expect(links[0].textContent).toBe('🔄 重新生成简介');
  expect(links[1].textContent).toBe('🔄 重新生成目录');  // Should change!

  // Chapter overview button should stay as "生成概要"
  const tocLinks = container.querySelectorAll('.ai-toc-link');
  expect(tocLinks[0].textContent).toBe('📝 生成概要');

  // Scenario 4: Chapter overview was generated
  const overviewH2 = document.createElement('h2');
  overviewH2.textContent = '📝 第1章：科学边界';
  container.appendChild(overviewH2);

  ns.updateButtonStates(container, 'test/path.md');
  expect(tocLinks[0].textContent).toBe('🔄 重新生成');  // Should change!
});
